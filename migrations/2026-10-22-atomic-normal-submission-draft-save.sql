BEGIN;

CREATE OR REPLACE FUNCTION public.save_final_project_submission_draft(
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
      MESSAGE = 'FP_SUBMISSION_DRAFT_NOT_FOUND:The submission was not found.';
  END IF;

  SELECT a.archived
  INTO v_assignment_archived
  FROM public.final_project_assignments AS a
  WHERE a.id = v_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_CONFLICT:The submission assignment no longer exists.';
  END IF;

  IF v_assignment_archived IS TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_FORBIDDEN:This assignment has been archived.';
  END IF;

  SELECT s.*
  INTO v_submission
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.assignment_id IS DISTINCT FROM v_assignment_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_CONFLICT:The submission assignment changed. Reload and try again.';
  END IF;

  IF v_submission.assessment_type <> 'submission' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_INVALID:This operation is only for Submission assessments.';
  END IF;

  IF v_submission.status NOT IN ('ASSIGNED', 'ACTIVATED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_CONFLICT:This submission is not available for an ordinary draft save.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.final_project_assignment_examiners AS ae
    WHERE ae.assignment_id = v_assignment_id
      AND ae.examiner_id = p_examiner_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_FORBIDDEN:The examiner is not assigned to this submission.';
  END IF;

  IF jsonb_typeof(COALESCE(p_grades, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_INVALID:Grades must be supplied as an object.';
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
        MESSAGE = 'FP_SUBMISSION_DRAFT_INVALID:An inactive or invalid criterion was supplied.';
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
        MESSAGE = 'FP_SUBMISSION_DRAFT_INVALID:A grade must be numeric.';
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
          MESSAGE = 'FP_SUBMISSION_DRAFT_INVALID:A grade is not a valid number.';
    END;

    IF v_grade < 0 OR v_grade > v_criterion.max_grade THEN
      RAISE EXCEPTION USING
        MESSAGE = 'FP_SUBMISSION_DRAFT_INVALID:A grade is outside the allowed criterion range.';
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

  IF v_assessment_status = 'SUBMITTED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_SUBMISSION_DRAFT_CONFLICT:Your assessment has already been submitted. Request administrator permission to re-grade it before making changes.';
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
    'DRAFT',
    NULL,
    NULL,
    NULL,
    COALESCE(p_feedback, ''),
    COALESCE(p_recommendations, ''),
    NULL,
    v_now
  )
  ON CONFLICT (submission_id, examiner_id)
  DO UPDATE SET
    status = 'DRAFT',
    average_grade = NULL,
    letter_grade = NULL,
    decision = NULL,
    feedback = EXCLUDED.feedback,
    recommendations = EXCLUDED.recommendations,
    submitted_at = NULL,
    updated_at = v_now;

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

  IF v_submission.status IN ('ASSIGNED', 'ACTIVATED') THEN
    UPDATE public.final_project_submissions
    SET status = 'IN_PROGRESS',
        average_grade = NULL,
        submitted_by = NULL,
        submitted_at = NULL,
        updated_at = v_now
    WHERE id = p_submission_id;
  END IF;

  RETURN jsonb_build_object(
    'saved', true,
    'status', 'DRAFT'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_final_project_submission_draft(
  uuid, uuid, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_final_project_submission_draft(
  uuid, uuid, jsonb, text, text, text
) TO service_role;

COMMIT;
