-- Atomic per-student Final Project assignment save.
-- Review-only draft. Do not apply until reviewed and approved.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_final_project_assignment_atomic(
  p_student_id uuid,
  p_examiner_ids uuid[],
  p_season04_confirmed boolean,
  p_season04_override boolean,
  p_assessment_activated boolean,
  p_admin_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_assignment public.final_project_assignments%ROWTYPE;
  v_requested_examiner_ids uuid[];
  v_current_examiner_ids uuid[];
  v_examiner_selection_changed boolean;
  v_has_progressed_submission boolean;
  v_has_assessment_records boolean;
  v_assessment_type text;
  v_target_status text;
  v_now timestamptz := now();
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_INVALID:A student is required.';
  END IF;

  IF p_admin_email IS NULL OR length(btrim(p_admin_email)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_INVALID:Administrator identity is required.';
  END IF;

  IF p_season04_confirmed IS NULL
     OR p_season04_override IS NULL
     OR p_assessment_activated IS NULL THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_INVALID:Assignment confirmation and activation flags are required.';
  END IF;

  IF p_examiner_ids IS NULL
     OR cardinality(p_examiner_ids) = 0
     OR array_position(p_examiner_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_INVALID:Select at least one valid examiner.';
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT requested.examiner_id ORDER BY requested.examiner_id),
    ARRAY[]::uuid[]
  )
  INTO v_requested_examiner_ids
  FROM unnest(p_examiner_ids) AS requested(examiner_id);

  IF cardinality(v_requested_examiner_ids) = 0 THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_INVALID:Select at least one valid examiner.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = p_student_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_NOT_FOUND:Student not found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_requested_examiner_ids) AS requested(examiner_id)
    LEFT JOIN public.examiners e ON e.id = requested.examiner_id
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE =
      'FP_ASSIGNMENT_INVALID:One or more selected examiners do not exist.';
  END IF;

  /*
   * The upsert obtains the assignment row lock before child rows are read
   * or modified. Preserve the existing route's created_by refresh behavior.
   */
  INSERT INTO public.final_project_assignments AS fpa (
    student_id,
    season04_confirmed,
    season04_override,
    season04_confirmed_by,
    season04_confirmed_at,
    assessment_activated,
    activated_by,
    activated_at,
    archived,
    created_by
  )
  VALUES (
    p_student_id,
    p_season04_confirmed,
    p_season04_override,
    p_admin_email,
    v_now,
    p_assessment_activated,
    CASE WHEN p_assessment_activated THEN p_admin_email ELSE NULL END,
    CASE WHEN p_assessment_activated THEN v_now ELSE NULL END,
    false,
    p_admin_email
  )
  ON CONFLICT (student_id) DO UPDATE SET
    season04_confirmed = EXCLUDED.season04_confirmed,
    season04_override = EXCLUDED.season04_override,
    season04_confirmed_by = EXCLUDED.season04_confirmed_by,
    season04_confirmed_at = EXCLUDED.season04_confirmed_at,
    assessment_activated = EXCLUDED.assessment_activated,
    activated_by = EXCLUDED.activated_by,
    activated_at = EXCLUDED.activated_at,
    archived = false,
    archived_by = NULL,
    archived_at = NULL,
    created_by = EXCLUDED.created_by
  RETURNING fpa.* INTO v_assignment;

  /*
   * Lock submissions in stable order, then examiner links. Do not lock
   * examiner links before submissions: regrading submission also locks
   * submission rows before it locks examiner links.
   */
  PERFORM s.id
  FROM public.final_project_submissions s
  WHERE s.assignment_id = v_assignment.id
  ORDER BY s.assessment_type, s.id
  FOR UPDATE;

  PERFORM ae.id
  FROM public.final_project_assignment_examiners ae
  WHERE ae.assignment_id = v_assignment.id
  ORDER BY ae.examiner_id
  FOR UPDATE;

  SELECT COALESCE(
    array_agg(ae.examiner_id ORDER BY ae.examiner_id),
    ARRAY[]::uuid[]
  )
  INTO v_current_examiner_ids
  FROM public.final_project_assignment_examiners ae
  WHERE ae.assignment_id = v_assignment.id;

  v_examiner_selection_changed :=
    v_current_examiner_ids IS DISTINCT FROM v_requested_examiner_ids;

  IF v_examiner_selection_changed THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.final_project_submissions s
      WHERE s.assignment_id = v_assignment.id
        AND s.status IN ('IN_PROGRESS', 'SUBMITTED', 'ARCHIVED')
    )
    INTO v_has_progressed_submission;

    SELECT EXISTS (
      SELECT 1
      FROM public.final_project_examiner_assessments ea
      JOIN public.final_project_submissions s
        ON s.id = ea.submission_id
      WHERE s.assignment_id = v_assignment.id
    )
    INTO v_has_assessment_records;

    IF v_has_progressed_submission OR v_has_assessment_records THEN
      RAISE EXCEPTION USING MESSAGE =
        'FP_ASSIGNMENT_CONFLICT:Examiner assignments cannot be changed after assessment work has started.';
    END IF;

    DELETE FROM public.final_project_assignment_examiners
    WHERE assignment_id = v_assignment.id;

    INSERT INTO public.final_project_assignment_examiners (
      assignment_id,
      examiner_id,
      assigned_by
    )
    SELECT
      v_assignment.id,
      requested.examiner_id,
      p_admin_email
    FROM unnest(v_requested_examiner_ids) AS requested(examiner_id);
  END IF;

  v_target_status :=
    CASE WHEN p_assessment_activated THEN 'ACTIVATED' ELSE 'ASSIGNED' END;

  /*
   * Insert missing submission/presentation rows. Change existing statuses
   * only while they remain NOT_ASSIGNED, ASSIGNED, or ACTIVATED.
   */
  FOREACH v_assessment_type IN ARRAY ARRAY['submission', 'presentation']::text[]
  LOOP
    INSERT INTO public.final_project_submissions (
      assignment_id,
      assessment_type,
      status
    )
    VALUES (
      v_assignment.id,
      v_assessment_type,
      v_target_status
    )
    ON CONFLICT (assignment_id, assessment_type) DO NOTHING;

    UPDATE public.final_project_submissions
    SET status = v_target_status,
        updated_at = v_now
    WHERE assignment_id = v_assignment.id
      AND assessment_type = v_assessment_type
      AND status IN ('NOT_ASSIGNED', 'ASSIGNED', 'ACTIVATED');
  END LOOP;

  /*
   * Audit logging was best-effort in the old route. Preserve that behavior:
   * an audit-only error must not undo the assignment save.
   */
  BEGIN
    INSERT INTO public.audit_log (
      admin_email,
      action,
      entity_type,
      entity_id,
      details
    )
    VALUES (
      p_admin_email,
      'final_project_assignment_saved',
      'final_project_assignment',
      v_assignment.id::text,
      jsonb_build_object(
        'studentId', p_student_id,
        'examinerIds', to_jsonb(v_requested_examiner_ids),
        'assessmentActivated', p_assessment_activated,
        'season04Confirmed', p_season04_confirmed,
        'season04Override', p_season04_override
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Unable to write assignment audit log for assignment %: %',
        v_assignment.id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'examinerSelectionChanged', v_examiner_selection_changed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_final_project_assignment_atomic(
  uuid, uuid[], boolean, boolean, boolean, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_final_project_assignment_atomic(
  uuid, uuid[], boolean, boolean, boolean, text
) TO service_role;

COMMIT;
