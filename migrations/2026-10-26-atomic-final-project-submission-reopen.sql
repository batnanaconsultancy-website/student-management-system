-- Atomically reopen a Final Project assessment and write its audit event.
-- Forward-only migration: do not overwrite an existing migration.
BEGIN;

DO $migration_preflight$
BEGIN
  IF to_regclass('public.final_project_assignments') IS NULL
     OR to_regclass('public.final_project_submissions') IS NULL THEN
    RAISE EXCEPTION
      'Atomic reopen migration aborted: Final Project assignment/submission tables are missing.';
  END IF;

  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION
      'Atomic reopen migration aborted: public.audit_log is missing. Apply the audit-table migration first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'final_project_assignments'
      AND column_name = 'archived'
  ) THEN
    RAISE EXCEPTION
      'Atomic reopen migration aborted: final_project_assignments.archived is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'final_project_submissions'
      AND column_name = 'reopened_by'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'final_project_submissions'
      AND column_name = 'reopened_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'final_project_submissions'
      AND column_name = 'reopen_reason'
  ) THEN
    RAISE EXCEPTION
      'Atomic reopen migration aborted: one or more submission reopen columns are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'admin_email'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'action'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'entity_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'entity_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'details'
  ) THEN
    RAISE EXCEPTION
      'Atomic reopen migration aborted: audit_log does not have the columns required by the reopen audit event.';
  END IF;
END;
$migration_preflight$;

CREATE OR REPLACE FUNCTION public.reopen_final_project_submission(
  p_submission_id uuid,
  p_admin_email text,
  p_reason text
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
  v_updated public.final_project_submissions%ROWTYPE;
  v_now timestamptz;
  v_audit_id uuid;
BEGIN
  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_INVALID: A valid submission ID is required.';
  END IF;

  IF p_admin_email IS NULL OR length(btrim(p_admin_email)) = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_FORBIDDEN: An authenticated administrator is required.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_INVALID: A reason is required.';
  END IF;

  IF length(btrim(p_reason)) > 2000 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_INVALID: The reason must be 2000 characters or fewer.';
  END IF;

  /*
   * Use the same lock order as the assessment draft/submit RPCs:
   * parent assignment first, then the submission row.
   */
  SELECT s.assignment_id
    INTO v_assignment_id
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_NOT_FOUND: Submission not found.';
  END IF;

  SELECT a.archived
    INTO v_assignment_archived
  FROM public.final_project_assignments AS a
  WHERE a.id = v_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_CONFLICT: The assignment no longer exists.';
  END IF;

  IF v_assignment_archived IS TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_FORBIDDEN: This assignment has been archived.';
  END IF;

  SELECT s.*
    INTO v_submission
  FROM public.final_project_submissions AS s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_submission.assignment_id IS DISTINCT FROM v_assignment_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_CONFLICT: The submission changed while reopening was being processed.';
  END IF;

  IF v_submission.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_CONFLICT: Only a submitted assessment can be reopened.';
  END IF;

  IF v_submission.submitted_at IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_CONFLICT: The submitted assessment has no submission timestamp and cannot be safely reopened.';
  END IF;

  IF v_submission.reopened_at IS NOT NULL
     AND v_submission.reopened_at > v_submission.submitted_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'FP_REOPEN_SUBMISSION_CONFLICT: This assessment is already reopened and awaiting correction.';
  END IF;

  -- Ensure the reopening timestamp is strictly newer than submitted_at.
  v_now := GREATEST(clock_timestamp(), v_submission.submitted_at + interval '1 microsecond');

  UPDATE public.final_project_submissions
  SET reopened_by = btrim(p_admin_email),
      reopened_at = v_now,
      reopen_reason = btrim(p_reason),
      updated_at = v_now
  WHERE id = p_submission_id
  RETURNING * INTO v_updated;

  /*
   * The audit event is part of this transaction. If the insert fails,
   * PostgreSQL rolls back the reopening update as well.
   */
  INSERT INTO public.audit_log (
    admin_email,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    btrim(p_admin_email),
    'final_project_submission_reopened',
    'final_project_submission',
    p_submission_id::text,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'assignmentId', v_assignment_id,
      'assessmentType', v_submission.assessment_type,
      'reopenedAt', v_now
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'submission', to_jsonb(v_updated),
    'auditId', v_audit_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_final_project_submission(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_final_project_submission(uuid, text, text)
  TO service_role;

COMMIT;
