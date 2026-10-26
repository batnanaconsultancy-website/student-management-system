-- Atomic Final Project re-grading workflow.
-- This is a forward migration. Review locally before applying to any database.

DO $migration_preflight$
DECLARE
  v_duplicate record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'final_project_grades'
      AND column_name = 'examiner_id'
  ) THEN
    RAISE EXCEPTION 'Migration aborted: public.final_project_grades.examiner_id is missing; grade ownership cannot be inferred safely.';
  END IF;

  SELECT submission_id, examiner_id, count(*) AS pending_count
    INTO v_duplicate
  FROM public.final_project_regrading_requests
  WHERE status = 'PENDING'
  GROUP BY submission_id, examiner_id
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Migration aborted: duplicate pending re-grading requests exist for submission %, examiner % (% rows). Resolve these records manually before retrying.',
      v_duplicate.submission_id, v_duplicate.examiner_id, v_duplicate.pending_count;
  END IF;
END;
$migration_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS final_project_regrading_one_pending_per_examiner_idx
  ON public.final_project_regrading_requests (submission_id, examiner_id)
  WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION public.create_final_project_regrading_request(
  p_submission_id uuid,
  p_examiner_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_submission public.final_project_submissions%ROWTYPE;
  v_assessment public.final_project_examiner_assessments%ROWTYPE;
  v_request public.final_project_regrading_requests%ROWTYPE;
  v_request_number integer;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:A reason for re-grading is required.';
  END IF;
  IF length(btrim(p_reason)) > 2000 THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:The re-grading reason must be 2000 characters or fewer.';
  END IF;

  SELECT * INTO v_submission
  FROM public.final_project_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_NOT_FOUND:Submission not found.';
  END IF;
  IF v_submission.assessment_type <> 'submission' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_INVALID:Re-grading requests are only available for Final Project Submission assessments.';
  END IF;
  IF v_submission.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The shared submission must be submitted before requesting re-grading.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.final_project_assignment_examiners ae
    WHERE ae.assignment_id = v_submission.assignment_id
      AND ae.examiner_id = p_examiner_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_FORBIDDEN:The examiner is not assigned to this submission.';
  END IF;

  SELECT * INTO v_assessment
  FROM public.final_project_examiner_assessments
  WHERE submission_id = p_submission_id AND examiner_id = p_examiner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_NOT_FOUND:Your examiner assessment was not found.';
  END IF;
  IF v_assessment.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:Your assessment has not been submitted yet.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.final_project_regrading_requests
    WHERE submission_id = p_submission_id
      AND examiner_id = p_examiner_id
      AND status = 'PENDING'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:A re-grading request is already pending administrator review.';
  END IF;

  SELECT COALESCE(MAX(request_number), 0) + 1 INTO v_request_number
  FROM public.final_project_regrading_requests
  WHERE submission_id = p_submission_id AND examiner_id = p_examiner_id;

  INSERT INTO public.final_project_regrading_requests (
    submission_id, examiner_id, request_number, reason, status
  ) VALUES (
    p_submission_id, p_examiner_id, v_request_number, btrim(p_reason), 'PENDING'
  ) RETURNING * INTO v_request;

  RETURN jsonb_build_object('request', jsonb_build_object(
    'id', v_request.id,
    'request_number', v_request.request_number,
    'status', v_request.status,
    'reason', v_request.reason,
    'created_at', v_request.created_at
  ));
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:A re-grading request conflicts with another request. Refresh and try again.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_final_project_regrading_request(
  p_request_id uuid,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_request public.final_project_regrading_requests%ROWTYPE;
  v_submission public.final_project_submissions%ROWTYPE;
  v_assessment public.final_project_examiner_assessments%ROWTYPE;
  v_history public.final_project_regrading_history%ROWTYPE;
  v_original_grades jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request
  FROM public.final_project_regrading_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_NOT_FOUND:Re-grading request not found.';
  END IF;
  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:This re-grading request is no longer pending.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = p_admin_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_FORBIDDEN:The administrator record was not found.';
  END IF;

  SELECT * INTO v_submission
  FROM public.final_project_submissions
  WHERE id = v_request.submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.assessment_type <> 'submission' OR v_submission.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The submission is missing, is not a Submission assessment, or is no longer submitted.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.final_project_assignment_examiners ae
    WHERE ae.assignment_id = v_submission.assignment_id
      AND ae.examiner_id = v_request.examiner_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The requesting examiner is no longer assigned to this submission.';
  END IF;

  SELECT * INTO v_assessment
  FROM public.final_project_examiner_assessments
  WHERE submission_id = v_request.submission_id
    AND examiner_id = v_request.examiner_id
  FOR UPDATE;
  IF NOT FOUND OR v_assessment.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The examiner assessment must be submitted before approval.';
  END IF;

  SELECT * INTO v_history
  FROM public.final_project_regrading_history
  WHERE regrading_request_id = v_request.id
  FOR UPDATE;
  IF FOUND THEN
    IF v_history.submission_id <> v_request.submission_id
       OR v_history.examiner_id <> v_request.examiner_id
       OR v_history.request_number <> v_request.request_number THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The existing history record does not match this request.';
    END IF;
    -- Never overwrite an existing original snapshot.
  ELSE
    SELECT jsonb_object_agg(g.criterion_id::text, g.grade)
    INTO v_original_grades
    FROM public.final_project_grades g
    WHERE g.submission_id = v_request.submission_id
      AND g.examiner_id = v_request.examiner_id;

    IF v_original_grades IS NULL OR v_original_grades = '{}'::jsonb THEN
      RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:No original examiner grades were found; approval cannot create a history snapshot.';
    END IF;

    INSERT INTO public.final_project_regrading_history (
      regrading_request_id, submission_id, examiner_id, request_number,
      original_grades, original_average_grade, original_letter_grade,
      original_decision, original_feedback, original_recommendations
    ) VALUES (
      v_request.id, v_request.submission_id, v_request.examiner_id,
      v_request.request_number, v_original_grades, v_assessment.average_grade,
      v_assessment.letter_grade, v_assessment.decision, v_assessment.feedback,
      v_assessment.recommendations
    ) RETURNING * INTO v_history;
  END IF;

  UPDATE public.final_project_regrading_requests
  SET status = 'APPROVED', reviewed_by = p_admin_id,
      reviewed_at = v_now, approved_at = v_now, updated_at = v_now
  WHERE id = v_request.id AND status = 'PENDING'
  RETURNING * INTO v_request;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'FP_REGRADING_CONFLICT:The request changed before approval could be completed.';
  END IF;

  RETURN jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_request.id,
      'submission_id', v_request.submission_id,
      'examiner_id', v_request.examiner_id,
      'request_number', v_request.request_number,
      'reason', v_request.reason,
      'status', v_request.status,
      'reviewed_by', v_request.reviewed_by,
      'reviewed_at', v_request.reviewed_at,
      'approved_at', v_request.approved_at,
      'created_at', v_request.created_at
    ),
    'historyId', v_history.id
  );
END;
$function$;

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
  IF NOT FOUND OR v_submission.assessment_type <> 'submission' OR v_submission.status <> 'SUBMITTED' THEN
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

  SELECT * INTO v_submission FROM public.final_project_submissions
  WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.assessment_type <> 'submission' OR v_submission.status <> 'SUBMITTED' THEN
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

REVOKE ALL ON FUNCTION public.create_final_project_regrading_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_final_project_regrading_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_final_project_regrading_draft(uuid, uuid, uuid, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_final_project_regrading(uuid, uuid, uuid, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_final_project_regrading_request(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_final_project_regrading_request(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_final_project_regrading_draft(uuid, uuid, uuid, jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_final_project_regrading(uuid, uuid, uuid, jsonb, text, text, text) TO service_role;
