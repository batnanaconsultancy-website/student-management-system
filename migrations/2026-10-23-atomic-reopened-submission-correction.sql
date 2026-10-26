BEGIN;

/*
 * Atomic correction workflow for an administrator-reopened Final Project
 * Submission. Apply only after reviewing and testing this migration.
 *
 * Saving preserves the shared submitted result and leaves the submission
 * reopened. Finalizing recalculates the overall result and advances
 * submitted_at to close the reopening.
 */
CREATE OR REPLACE FUNCTION public.save_final_project_reopened_submission_draft(
  p_submission_id uuid,
  p_examiner_id uuid,
  p_grades jsonb,
  p_feedback text,
  p_recommendations text,
  p_signature_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_assignment_id uuid;
  v_assignment_archived boolean;
  v_submission public.final_project_submissions%ROWTYPE;
  v_assessment_status text;
  v_criterion record;
  v_entry record;
  v_grade numeric;
  v_grade_text text;
  v_now timestamptz := now();
BEGIN
  /*
   * Establish the assignment before acquiring locks. The parent
   * assignment is locked before the submission to establish a
   * consistent lock order for cooperating database operations.
   */
  SELECT s.assignment_id
  INTO v_assignment_id
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_NOT_FOUND:The submission was not found.';
  END IF;

  SELECT a.archived
  INTO v_assignment_archived
  FROM public.final_project_assignments AS a
  WHERE a.id = v_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_CONFLICT:The submission assignment no longer exists.';
  END IF;

  IF v_assignment_archived IS TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_FORBIDDEN:This assignment has been archived.';
  END IF;

  SELECT s.*
  INTO v_submission
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.assignment_id IS DISTINCT FROM v_assignment_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_CONFLICT:The submission assignment changed. Reload and try again.';
  END IF;

  IF v_submission.assessment_type <> 'submission' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_INVALID:This operation is only for Submission assessments.';
  END IF;

  IF v_submission.status IS DISTINCT FROM 'SUBMITTED'
     OR v_submission.reopened_at IS NULL
     OR v_submission.submitted_at IS NULL
     OR v_submission.reopened_at <= v_submission.submitted_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_CONFLICT:This submission is no longer reopened for correction.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.final_project_assignment_examiners AS ae
    WHERE ae.assignment_id = v_assignment_id
      AND ae.examiner_id = p_examiner_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_FORBIDDEN:The examiner is not assigned to this submission.';
  END IF;

  IF jsonb_typeof(COALESCE(p_grades, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_INVALID:Grades must be supplied as an object.';
  END IF;

  /*
   * Lock currently active criteria in a stable order while validating
   * the submitted grade keys and ranges.
   */
  PERFORM c.id
  FROM public.final_project_criteria AS c
  WHERE c.assessment_type = 'submission'
    AND c.is_active = true
  ORDER BY c.id
  FOR SHARE;

  FOR v_entry IN
    SELECT key, value
    FROM jsonb_each(COALESCE(p_grades, '{}'::jsonb))
  LOOP
    SELECT c.id, c.max_grade
    INTO v_criterion
    FROM public.final_project_criteria AS c
    WHERE c.id::text = v_entry.key
      AND c.assessment_type = 'submission'
      AND c.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_INVALID:An inactive or invalid criterion was supplied.';
    END IF;

    /*
     * Match existing draft-save behavior: null and empty grades are
     * skipped, so an omitted grade does not erase a previously saved
     * grade.
     */
    IF v_entry.value = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_entry.value) NOT IN ('number', 'string') THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_INVALID:A grade must be numeric.';
    END IF;

    v_grade_text := v_entry.value #>> '{}';

    IF v_grade_text IS NULL OR btrim(v_grade_text) = '' THEN
      CONTINUE;
    END IF;

    BEGIN
      v_grade := btrim(v_grade_text)::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING
          MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_INVALID:A grade is not a valid number.';
    END;

    IF v_grade < 0 OR v_grade > v_criterion.max_grade THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_INVALID:A grade is outside the allowed criterion range.';
    END IF;
  END LOOP;

  /*
   * Serialize with cooperating save/submit RPCs through the locked
   * submission row. Do not permit an ordinary save to reset a
   * previously submitted examiner assessment.
   */
  SELECT a.status
  INTO v_assessment_status
  FROM public.final_project_examiner_assessments AS a
  WHERE a.submission_id = p_submission_id
    AND a.examiner_id = p_examiner_id
  FOR UPDATE;

  IF v_assessment_status IS DISTINCT FROM 'SUBMITTED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_CONFLICT:Only your previously submitted assessment can be corrected through this operation.';
  END IF;

  /*
   * All following writes are part of this same PostgreSQL transaction.
   */
  FOR v_entry IN
    SELECT key, value
    FROM jsonb_each(COALESCE(p_grades, '{}'::jsonb))
  LOOP
    IF v_entry.value = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    v_grade_text := v_entry.value #>> '{}';

    IF v_grade_text IS NULL OR btrim(v_grade_text) = '' THEN
      CONTINUE;
    END IF;

    v_grade := btrim(v_grade_text)::numeric;

    INSERT INTO public.final_project_grades (
      submission_id,
      criterion_id,
      examiner_id,
      grade
    )
    VALUES (
      p_submission_id,
      v_entry.key::uuid,
      p_examiner_id,
      v_grade
    )
    ON CONFLICT (submission_id, criterion_id, examiner_id)
    DO UPDATE SET
      grade = EXCLUDED.grade,
      updated_at = v_now;
  END LOOP;

  UPDATE public.final_project_examiner_assessments
  SET feedback = COALESCE(p_feedback, ''),
      recommendations = COALESCE(p_recommendations, ''),
      updated_at = v_now
  WHERE submission_id = p_submission_id
    AND examiner_id = p_examiner_id
    AND status = 'SUBMITTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SAVE_CONFLICT:The submitted examiner assessment changed. Reload and try again.';
  END IF;

  IF p_signature_text IS NOT NULL
     AND length(btrim(p_signature_text)) > 0 THEN
    INSERT INTO public.final_project_signatures (
      submission_id,
      examiner_id,
      signature_text,
      signed_at
    )
    VALUES (
      p_submission_id,
      p_examiner_id,
      btrim(p_signature_text),
      v_now
    )
    ON CONFLICT (submission_id, examiner_id)
    DO UPDATE SET
      signature_text = EXCLUDED.signature_text,
      signed_at = v_now;
  END IF;

  /*
   * Deliberately do not change the shared submission status, overall
   * result, submitted_at, or submitted_by. Saving leaves it reopened.
   */
  RETURN jsonb_build_object(
    'saved', true,
    'status', 'SUBMITTED',
    'correction', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_final_project_reopened_submission_draft(
  uuid, uuid, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_final_project_reopened_submission_draft(
  uuid, uuid, jsonb, text, text, text
) TO service_role;



CREATE OR REPLACE FUNCTION public.submit_final_project_reopened_submission(
  p_submission_id uuid,
  p_examiner_id uuid,
  p_grades jsonb,
  p_signature_text text,
  p_feedback text,
  p_recommendations text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_assignment_id uuid;
  v_locked_assignment_id uuid;
  v_status text;
  v_assessment_type text;
  v_reopened_at timestamptz;
  v_submitted_at timestamptz;
  v_assignment_archived boolean;
  v_own_status text;
  v_criterion record;
  v_entry record;
  v_numeric_grade numeric;
  v_max_grade numeric;
  v_grade_sum numeric := 0;
  v_criterion_count integer := 0;
  v_examiner_average numeric;
  v_examiner_letter text;
  v_examiner_decision text;
  v_assigned_count integer := 0;
  v_submitted_count integer := 0;
  v_overall_average numeric;
  v_overall_letter text;
  v_overall_decision text;
  v_now timestamptz := clock_timestamp();
BEGIN
  /*
   * Establish the lock order used by normal draft-save and submit:
   * parent assignment first, then its submission.
   */
  SELECT s.assignment_id
    INTO v_assignment_id
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_NOT_FOUND: Submission not found.';
  END IF;

  SELECT a.id, a.archived
    INTO v_locked_assignment_id, v_assignment_archived
  FROM public.final_project_assignments AS a
  WHERE a.id = v_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_NOT_FOUND: Assignment not found.';
  END IF;

  SELECT s.assignment_id, s.assessment_type, s.status,
         s.reopened_at, s.submitted_at
    INTO v_locked_assignment_id, v_assessment_type, v_status,
         v_reopened_at, v_submitted_at
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_NOT_FOUND: Submission not found.';
  END IF;

  IF v_locked_assignment_id IS DISTINCT FROM v_assignment_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_CONFLICT: The submission assignment changed; retry the operation.';
  END IF;

  IF v_assessment_type IS DISTINCT FROM 'submission' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: This RPC only handles Submission assessments.';
  END IF;

  IF v_assignment_archived IS TRUE OR v_status = 'ARCHIVED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_FORBIDDEN: This assessment has been archived.';
  END IF;

  IF v_status IS DISTINCT FROM 'SUBMITTED'
     OR v_reopened_at IS NULL
     OR v_submitted_at IS NULL
     OR v_reopened_at <= v_submitted_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_CONFLICT: This submission is no longer reopened for correction.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.final_project_assignment_examiners AS ae
    WHERE ae.assignment_id = v_assignment_id
      AND ae.examiner_id = p_examiner_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_FORBIDDEN: You are not assigned to this assessment.';
  END IF;

  IF p_grades IS NULL OR jsonb_typeof(p_grades) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Grades must be supplied as an object.';
  END IF;

  IF p_signature_text IS NULL OR btrim(p_signature_text) = '' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Signature required. Type your full name before submitting.';
  END IF;

  /*
   * Prevent criterion edits/inserts/deactivations from changing the
   * active criterion set partway through this transaction.
   */
  LOCK TABLE public.final_project_criteria IN SHARE MODE;

  /*
   * Count and validate the active criteria. Every active criterion
   * must have a numeric grade within its configured range.
   */
  FOR v_criterion IN
    SELECT c.id, c.label, c.max_grade
    FROM public.final_project_criteria AS c
    WHERE c.assessment_type = 'submission'
      AND c.is_active = true
    ORDER BY c.id
    FOR SHARE
  LOOP
    v_criterion_count := v_criterion_count + 1;

    IF NOT (p_grades ? v_criterion.id::text) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Every active criterion must have a grade. Missing: '
          || v_criterion.label || '.';
    END IF;

    IF jsonb_typeof(p_grades -> v_criterion.id::text)
         NOT IN ('number', 'string') THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Invalid grade for criterion: '
          || v_criterion.label || '.';
    END IF;

    BEGIN
      v_numeric_grade :=
        NULLIF(btrim(p_grades ->> v_criterion.id::text), '')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING
          MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Invalid grade for criterion: '
            || v_criterion.label || '.';
    END;

    IF v_numeric_grade IS NULL
       OR v_numeric_grade < 0
       OR v_numeric_grade > v_criterion.max_grade THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Invalid grade for criterion: '
          || v_criterion.label || '.';
    END IF;

    v_grade_sum := v_grade_sum + v_numeric_grade;
  END LOOP;

  IF v_criterion_count = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: No active Submission assessment criteria were found.';
  END IF;

  /*
   * Reject keys that do not identify active Submission criteria.
   */
  FOR v_entry IN
    SELECT e.key
    FROM jsonb_each(p_grades) AS e
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.final_project_criteria AS c
      WHERE c.id::text = v_entry.key
        AND c.assessment_type = 'submission'
        AND c.is_active = true
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_INVALID: Invalid criterion: '
          || v_entry.key;
    END IF;
  END LOOP;

  /*
   * Serialize against cooperating draft-save/submit calls via the
   * locked submission row, then prevent edits to a submitted assessment.
   */
  SELECT ea.status
    INTO v_own_status
  FROM public.final_project_examiner_assessments AS ea
  WHERE ea.submission_id = p_submission_id
    AND ea.examiner_id = p_examiner_id
  FOR UPDATE;

  IF v_own_status IS DISTINCT FROM 'SUBMITTED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_CONFLICT: Only your previously submitted assessment can be corrected through this operation.';
  END IF;

  v_examiner_average := round(
    v_grade_sum / v_criterion_count,
    2
  );

  v_examiner_letter := CASE
    WHEN v_examiner_average >= 88 THEN 'E'
    WHEN v_examiner_average >= 74 THEN 'G'
    WHEN v_examiner_average >= 60 THEN 'S'
    WHEN v_examiner_average >= 53 THEN 'F'
    ELSE 'P'
  END;

  v_examiner_decision := CASE
    WHEN v_examiner_average >= 60 THEN 'PASS'
    ELSE 'FAIL'
  END;

  /*
   * Persist this examiner's complete assessment.
   */
  FOR v_criterion IN
    SELECT c.id
    FROM public.final_project_criteria AS c
    WHERE c.assessment_type = 'submission'
      AND c.is_active = true
    ORDER BY c.id
  LOOP
    v_numeric_grade := (p_grades ->> v_criterion.id::text)::numeric;

    INSERT INTO public.final_project_grades (
      submission_id,
      criterion_id,
      examiner_id,
      grade,
      updated_at
    )
    VALUES (
      p_submission_id,
      v_criterion.id,
      p_examiner_id,
      v_numeric_grade,
      v_now
    )
    ON CONFLICT (submission_id, criterion_id, examiner_id)
    DO UPDATE SET
      grade = EXCLUDED.grade,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  INSERT INTO public.final_project_signatures (
    submission_id,
    examiner_id,
    signature_text,
    signed_at
  )
  VALUES (
    p_submission_id,
    p_examiner_id,
    btrim(p_signature_text),
    v_now
  )
  ON CONFLICT (submission_id, examiner_id)
  DO UPDATE SET
    signature_text = EXCLUDED.signature_text,
    signed_at = EXCLUDED.signed_at;

  INSERT INTO public.final_project_examiner_assessments (
    submission_id,
    examiner_id,
    status,
    average_grade,
    letter_grade,
    decision,
    feedback,
    recommendations,
    submitted_at,
    updated_at
  )
  VALUES (
    p_submission_id,
    p_examiner_id,
    'SUBMITTED',
    v_examiner_average,
    v_examiner_letter,
    v_examiner_decision,
    p_feedback,
    p_recommendations,
    v_now,
    v_now
  )
  ON CONFLICT (submission_id, examiner_id)
  DO UPDATE SET
    status = 'SUBMITTED',
    average_grade = EXCLUDED.average_grade,
    letter_grade = EXCLUDED.letter_grade,
    decision = EXCLUDED.decision,
    feedback = EXCLUDED.feedback,
    recommendations = EXCLUDED.recommendations,
    submitted_at = EXCLUDED.submitted_at,
    updated_at = EXCLUDED.updated_at;

  /*
   * Lock the currently assigned examiner links in a stable order.
   */
  PERFORM ae.id
  FROM public.final_project_assignment_examiners AS ae
  WHERE ae.assignment_id = v_assignment_id
  ORDER BY ae.examiner_id
  FOR UPDATE;

  SELECT count(DISTINCT ae.examiner_id)::integer
    INTO v_assigned_count
  FROM public.final_project_assignment_examiners AS ae
  WHERE ae.assignment_id = v_assignment_id;

  IF v_assigned_count = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_CONFLICT: No examiners are assigned to this submission.';
  END IF;

  SELECT count(DISTINCT ae.examiner_id)::integer
    INTO v_submitted_count
  FROM public.final_project_assignment_examiners AS ae
  JOIN public.final_project_examiner_assessments AS ea
    ON ea.submission_id = p_submission_id
   AND ea.examiner_id = ae.examiner_id
   AND ea.status = 'SUBMITTED'
  WHERE ae.assignment_id = v_assignment_id;

  IF v_submitted_count < v_assigned_count THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_CONFLICT: Every currently assigned examiner must still have a submitted assessment before a correction can be finalized.';
  END IF;

  /*
   * Every assigned examiner has submitted. Do not mark the shared
   * submission complete if any submitted assessment lacks an average.
   */
  IF EXISTS (
    SELECT 1
    FROM public.final_project_assignment_examiners AS ae
    JOIN public.final_project_examiner_assessments AS ea
      ON ea.submission_id = p_submission_id
     AND ea.examiner_id = ae.examiner_id
     AND ea.status = 'SUBMITTED'
    WHERE ae.assignment_id = v_assignment_id
      AND ea.average_grade IS NULL
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPENED_SUBMISSION_SUBMIT_CONFLICT: One or more submitted examiner assessments has no average grade.';
  END IF;

  SELECT round(avg(ea.average_grade), 2)
    INTO v_overall_average
  FROM public.final_project_assignment_examiners AS ae
  JOIN public.final_project_examiner_assessments AS ea
    ON ea.submission_id = p_submission_id
   AND ea.examiner_id = ae.examiner_id
   AND ea.status = 'SUBMITTED'
  WHERE ae.assignment_id = v_assignment_id;

  v_overall_letter := CASE
    WHEN v_overall_average >= 88 THEN 'E'
    WHEN v_overall_average >= 74 THEN 'G'
    WHEN v_overall_average >= 60 THEN 'S'
    WHEN v_overall_average >= 53 THEN 'F'
    ELSE 'P'
  END;

  v_overall_decision := CASE
    WHEN v_overall_average >= 60 THEN 'PASS'
    ELSE 'FAIL'
  END;

  UPDATE public.final_project_submissions
  SET status = 'SUBMITTED',
      average_grade = v_overall_average,
      submitted_at = v_now,
      updated_at = v_now
  WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'submitted', true,
    'correction', true,
    'examinerAverage', v_examiner_average,
    'letterGrade', v_examiner_letter,
    'decision', v_examiner_decision,
    'allExaminersSubmitted', true,
    'submittedExaminerCount', v_assigned_count,
    'totalExaminerCount', v_assigned_count,
    'overallAverage', v_overall_average,
    'overallLetterGrade', v_overall_letter,
    'overallDecision', v_overall_decision
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_final_project_reopened_submission(
  uuid, uuid, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_final_project_reopened_submission(
  uuid, uuid, jsonb, text, text, text
) TO service_role;

COMMIT;
