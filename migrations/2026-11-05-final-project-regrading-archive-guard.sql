BEGIN;

CREATE OR REPLACE FUNCTION public.save_final_project_regrading_draft(
  p_request_id uuid,
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
  v_request public.final_project_regrading_requests%ROWTYPE;
  v_assignment public.final_project_assignments%ROWTYPE;
  v_submission public.final_project_submissions%ROWTYPE;
  v_criterion record;
  v_entry record;
  v_grade numeric;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM public.final_project_regrading_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.submission_id <> p_submission_id OR v_request.examiner_id <> p_examiner_id THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The re-grading request does not match this examiner and submission.';
  END IF;
  IF v_request.status <> 'APPROVED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:Only an approved re-grading request can be saved.';
  END IF;

  -- Lock the parent assignment before locking or modifying the submission.
  SELECT a.* INTO v_assignment
  FROM public.final_project_assignments a
  JOIN public.final_project_submissions s
    ON s.assignment_id = a.id
  WHERE s.id = p_submission_id
  FOR UPDATE OF a;

  IF NOT FOUND OR v_assignment.archived IS TRUE THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_REGRADING_CONFLICT:The assignment is missing or archived; re-grading is not permitted.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.final_project_regrading_history h
    WHERE h.regrading_request_id = v_request.id
      AND h.submission_id = p_submission_id AND h.examiner_id = p_examiner_id
      AND h.request_number = v_request.request_number
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The approved request has no matching original history snapshot.';
  END IF;

  SELECT * INTO v_submission FROM public.final_project_submissions
  WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.assignment_id IS DISTINCT FROM v_assignment.id OR v_submission.assessment_type <> 'submission' OR v_submission.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The shared submission must remain submitted while re-grading.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.final_project_assignment_examiners ae
    WHERE ae.assignment_id = v_submission.assignment_id AND ae.examiner_id = p_examiner_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_FORBIDDEN:The examiner is not assigned to this submission.';
  END IF;
  IF jsonb_typeof(COALESCE(p_grades, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:Grades must be supplied as an object.';
  END IF;

  FOR v_entry IN SELECT key, value FROM jsonb_each(COALESCE(p_grades, '{}'::jsonb)) LOOP
    SELECT id, max_grade INTO v_criterion
    FROM public.final_project_criteria
    WHERE id::text = v_entry.key AND assessment_type = 'submission' AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:An inactive or invalid criterion was supplied.';
    END IF;
    IF v_entry.value = 'null'::jsonb OR v_entry.value #>> '{}' = '' THEN
      CONTINUE;
    END IF;
    BEGIN
      v_grade := (v_entry.value #>> '{}')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:A grade is not numeric.';
    END;
    IF v_grade < 0 OR v_grade > v_criterion.max_grade THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:A grade is outside the allowed criterion range.';
    END IF;
    INSERT INTO public.final_project_grades (submission_id, criterion_id, examiner_id, grade)
    VALUES (p_submission_id, v_criterion.id, p_examiner_id, v_grade)
    ON CONFLICT (submission_id, criterion_id, examiner_id)
    DO UPDATE SET grade = EXCLUDED.grade, updated_at = v_now;
  END LOOP;

  INSERT INTO public.final_project_examiner_assessments (
    submission_id, examiner_id, status, feedback, recommendations,
    average_grade, letter_grade, decision, submitted_at, updated_at
  ) VALUES (
    p_submission_id, p_examiner_id, 'DRAFT', COALESCE(p_feedback, ''),
    COALESCE(p_recommendations, ''), NULL, NULL, NULL, NULL, v_now
  )
  ON CONFLICT (submission_id, examiner_id) DO UPDATE SET
    status = 'DRAFT', feedback = EXCLUDED.feedback,
    recommendations = EXCLUDED.recommendations, average_grade = NULL,
    letter_grade = NULL, decision = NULL, submitted_at = NULL, updated_at = v_now;

  IF p_signature_text IS NOT NULL AND length(btrim(p_signature_text)) > 0 THEN
    INSERT INTO public.final_project_signatures (
      submission_id, examiner_id, signature_text, signed_at
    ) VALUES (p_submission_id, p_examiner_id, p_signature_text, v_now)
    ON CONFLICT (submission_id, examiner_id) DO UPDATE SET
      signature_text = EXCLUDED.signature_text, signed_at = v_now;
  END IF;

  RETURN jsonb_build_object('saved', true, 'status', 'DRAFT');
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_final_project_regrading(
  p_request_id uuid,
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
  v_request public.final_project_regrading_requests%ROWTYPE;
  v_assignment public.final_project_assignments%ROWTYPE;
  v_submission public.final_project_submissions%ROWTYPE;
  v_assessment public.final_project_examiner_assessments%ROWTYPE;
  v_history public.final_project_regrading_history%ROWTYPE;
  v_criterion record;
  v_entry record;
  v_grade numeric;
  v_examiner_average numeric(6,2);
  v_examiner_letter text;
  v_examiner_decision text;
  v_overall_average numeric(6,2);
  v_overall_letter text;
  v_overall_decision text;
  v_assigned_count integer;
  v_incomplete_count integer;
  v_now timestamptz := now();
  v_revised_grades jsonb;
BEGIN
  SELECT * INTO v_request FROM public.final_project_regrading_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.submission_id <> p_submission_id OR v_request.examiner_id <> p_examiner_id THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The re-grading request does not match this examiner and submission.';
  END IF;
  IF v_request.status <> 'APPROVED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:Only an approved re-grading request can be submitted.';
  END IF;

  -- Lock the parent assignment before locking or modifying the submission.
  SELECT a.* INTO v_assignment
  FROM public.final_project_assignments a
  JOIN public.final_project_submissions s
    ON s.assignment_id = a.id
  WHERE s.id = p_submission_id
  FOR UPDATE OF a;

  IF NOT FOUND OR v_assignment.archived IS TRUE THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_REGRADING_CONFLICT:The assignment is missing or archived; re-grading is not permitted.';
  END IF;

  SELECT * INTO v_submission FROM public.final_project_submissions
  WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.assignment_id IS DISTINCT FROM v_assignment.id OR v_submission.assessment_type <> 'submission' OR v_submission.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The shared submission must remain submitted while re-grading.';
  END IF;

  SELECT * INTO v_history FROM public.final_project_regrading_history
  WHERE regrading_request_id = v_request.id FOR UPDATE;
  IF NOT FOUND OR v_history.submission_id <> p_submission_id
     OR v_history.examiner_id <> p_examiner_id
     OR v_history.request_number <> v_request.request_number
     OR v_history.completed_at IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The original history snapshot is missing, mismatched, or already completed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.final_project_assignment_examiners ae
    WHERE ae.assignment_id = v_submission.assignment_id AND ae.examiner_id = p_examiner_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_FORBIDDEN:The examiner is not assigned to this submission.';
  END IF;
  IF p_signature_text IS NULL OR length(btrim(p_signature_text)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:A signature is required before submission.';
  END IF;
  IF jsonb_typeof(COALESCE(p_grades, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:Grades must be supplied as an object.';
  END IF;

  -- Prevent finalizing a re-grade while another assigned examiner is incomplete.
  PERFORM 1 FROM public.final_project_assignment_examiners ae
  WHERE ae.assignment_id = v_submission.assignment_id
  FOR UPDATE;
  SELECT count(*) INTO v_assigned_count
  FROM public.final_project_assignment_examiners ae
  WHERE ae.assignment_id = v_submission.assignment_id;
  IF v_assigned_count = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:No examiners are assigned to this submission.';
  END IF;
  SELECT count(*) INTO v_incomplete_count
  FROM public.final_project_assignment_examiners ae
  LEFT JOIN public.final_project_examiner_assessments a
    ON a.submission_id = p_submission_id AND a.examiner_id = ae.examiner_id
  WHERE ae.assignment_id = v_submission.assignment_id
    AND ae.examiner_id <> p_examiner_id
    AND COALESCE(a.status, '') <> 'SUBMITTED';
  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:All other assigned examiners must remain submitted before this re-grading can be finalized.';
  END IF;

  -- Reject unknown keys and require every currently active Submission criterion.
  FOR v_entry IN SELECT key, value FROM jsonb_each(COALESCE(p_grades, '{}'::jsonb)) LOOP
    SELECT id, max_grade INTO v_criterion
    FROM public.final_project_criteria
    WHERE id::text = v_entry.key AND assessment_type = 'submission' AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:An inactive or invalid criterion was supplied.';
    END IF;
  END LOOP;

  FOR v_criterion IN
    SELECT id, max_grade FROM public.final_project_criteria
    WHERE assessment_type = 'submission' AND is_active = true
    ORDER BY display_order
  LOOP
    IF NOT (COALESCE(p_grades, '{}'::jsonb) ? v_criterion.id::text)
       OR p_grades -> v_criterion.id::text = 'null'::jsonb
       OR COALESCE(p_grades ->> v_criterion.id::text, '') = '' THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:Every active Submission criterion must have a grade.';
    END IF;
    BEGIN
      v_grade := (p_grades ->> v_criterion.id::text)::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:A grade is not numeric.';
    END;
    IF v_grade < 0 OR v_grade > v_criterion.max_grade THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:A grade is outside the allowed criterion range.';
    END IF;
    INSERT INTO public.final_project_grades (submission_id, criterion_id, examiner_id, grade)
    VALUES (p_submission_id, v_criterion.id, p_examiner_id, v_grade)
    ON CONFLICT (submission_id, criterion_id, examiner_id)
    DO UPDATE SET grade = EXCLUDED.grade, updated_at = v_now;
  END LOOP;

  SELECT round(avg((p_grades ->> c.id::text)::numeric), 2)
  INTO v_examiner_average
  FROM public.final_project_criteria c
  WHERE c.assessment_type = 'submission' AND c.is_active = true;
  IF v_examiner_average IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:No active Submission criteria are configured.';
  END IF;
  v_examiner_letter := CASE
    WHEN v_examiner_average >= 88 THEN 'E'
    WHEN v_examiner_average >= 74 THEN 'G'
    WHEN v_examiner_average >= 60 THEN 'S'
    WHEN v_examiner_average >= 53 THEN 'F'
    ELSE 'P' END;
  v_examiner_decision := CASE WHEN v_examiner_average >= 60 THEN 'PASS' ELSE 'FAIL' END;

  INSERT INTO public.final_project_signatures (
    submission_id, examiner_id, signature_text, signed_at
  ) VALUES (p_submission_id, p_examiner_id, btrim(p_signature_text), v_now)
  ON CONFLICT (submission_id, examiner_id) DO UPDATE SET
    signature_text = EXCLUDED.signature_text, signed_at = v_now;

  INSERT INTO public.final_project_examiner_assessments (
    submission_id, examiner_id, status, average_grade, letter_grade, decision,
    feedback, recommendations, submitted_at, updated_at
  ) VALUES (
    p_submission_id, p_examiner_id, 'SUBMITTED', v_examiner_average,
    v_examiner_letter, v_examiner_decision, COALESCE(p_feedback, ''),
    COALESCE(p_recommendations, ''), v_now, v_now
  )
  ON CONFLICT (submission_id, examiner_id) DO UPDATE SET
    status = 'SUBMITTED', average_grade = EXCLUDED.average_grade,
    letter_grade = EXCLUDED.letter_grade, decision = EXCLUDED.decision,
    feedback = EXCLUDED.feedback, recommendations = EXCLUDED.recommendations,
    submitted_at = v_now, updated_at = v_now;

  SELECT count(*) INTO v_incomplete_count
  FROM public.final_project_assignment_examiners ae
  LEFT JOIN public.final_project_examiner_assessments a
    ON a.submission_id = p_submission_id AND a.examiner_id = ae.examiner_id
  WHERE ae.assignment_id = v_submission.assignment_id
    AND (a.status IS DISTINCT FROM 'SUBMITTED' OR a.average_grade IS NULL);
  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:Not all assigned examiner assessments are submitted with an average grade.';
  END IF;

  SELECT round(avg(a.average_grade), 2) INTO v_overall_average
  FROM public.final_project_assignment_examiners ae
  JOIN public.final_project_examiner_assessments a
    ON a.submission_id = p_submission_id AND a.examiner_id = ae.examiner_id
  WHERE ae.assignment_id = v_submission.assignment_id;
  v_overall_letter := CASE
    WHEN v_overall_average >= 88 THEN 'E'
    WHEN v_overall_average >= 74 THEN 'G'
    WHEN v_overall_average >= 60 THEN 'S'
    WHEN v_overall_average >= 53 THEN 'F'
    ELSE 'P' END;
  v_overall_decision := CASE WHEN v_overall_average >= 60 THEN 'PASS' ELSE 'FAIL' END;

  SELECT jsonb_object_agg(c.id::text, (p_grades ->> c.id::text)::numeric)
  INTO v_revised_grades
  FROM public.final_project_criteria c
  WHERE c.assessment_type = 'submission' AND c.is_active = true;

  UPDATE public.final_project_submissions
  SET average_grade = v_overall_average, updated_at = v_now
  WHERE id = p_submission_id AND status = 'SUBMITTED';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The shared submission changed before the re-grading could be finalized.';
  END IF;

  UPDATE public.final_project_regrading_history
  SET revised_grades = v_revised_grades,
      revised_average_grade = v_examiner_average,
      revised_letter_grade = v_examiner_letter,
      revised_decision = v_examiner_decision,
      revised_feedback = COALESCE(p_feedback, ''),
      revised_recommendations = COALESCE(p_recommendations, ''),
      completed_at = v_now
  WHERE id = v_history.id AND regrading_request_id = v_request.id
    AND submission_id = p_submission_id AND examiner_id = p_examiner_id
    AND completed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The revised history could not be completed.';
  END IF;

  UPDATE public.final_project_regrading_requests
  SET status = 'COMPLETED', completed_at = v_now, updated_at = v_now
  WHERE id = v_request.id AND status = 'APPROVED';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The request was no longer approved when completion was attempted.';
  END IF;

  RETURN jsonb_build_object(
    'submitted', true,
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


REVOKE ALL ON FUNCTION public.save_final_project_regrading_draft(
    uuid, uuid, uuid, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_final_project_regrading(
    uuid, uuid, uuid, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_final_project_regrading_draft(
    uuid, uuid, uuid, jsonb, text, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.submit_final_project_regrading(
    uuid, uuid, uuid, jsonb, text, text, text
) TO service_role;


COMMIT;
