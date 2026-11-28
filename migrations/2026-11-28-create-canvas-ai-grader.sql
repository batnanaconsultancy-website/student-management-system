-- Canvas Bachelor / Masters assessment and AI grading foundation.
-- This migration is additive: existing Canvas attendance, outcomes,
-- current-state submissions, and Final Project Examiner workflows remain intact.

ALTER TABLE public.canvas_courses
  ADD COLUMN IF NOT EXISTS account_id BIGINT,
  ADD COLUMN IF NOT EXISTS workflow_state TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_term_id BIGINT,
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS course_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.canvas_assessment_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('canvas_bachelor', 'canvas_masters')),
  canvas_course_id BIGINT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  selected_by TEXT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, canvas_course_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_assessment_courses_scope
  ON public.canvas_assessment_courses(scope, is_enabled);

CREATE TABLE IF NOT EXISTS public.canvas_assessment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('canvas_bachelor', 'canvas_masters')),
  canvas_course_id BIGINT NOT NULL,
  canvas_assignment_id BIGINT NOT NULL,
  is_assessment BOOLEAN NOT NULL DEFAULT FALSE,
  selected_by TEXT,
  selected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, canvas_course_id, canvas_assignment_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_assessment_assignments_scope
  ON public.canvas_assessment_assignments(scope, canvas_course_id, is_assessment);

CREATE TABLE IF NOT EXISTS public.canvas_assessment_config_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('canvas_bachelor', 'canvas_masters')),
  canvas_course_id BIGINT NOT NULL,
  canvas_assignment_id BIGINT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_assessment_config_audit_course
  ON public.canvas_assessment_config_audit(scope, canvas_course_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.canvas_assessment_examiners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  examiner_id UUID NOT NULL REFERENCES public.examiners(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('canvas_bachelor', 'canvas_masters')),
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (examiner_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_canvas_assessment_examiners_scope
  ON public.canvas_assessment_examiners(scope, examiner_id);

-- Immutable evidence snapshots per Canvas attempt. Existing
-- canvas_submissions remains the legacy current-state projection.
CREATE TABLE IF NOT EXISTS public.canvas_submission_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_course_id BIGINT NOT NULL,
  canvas_assignment_id BIGINT NOT NULL,
  canvas_student_id UUID NOT NULL REFERENCES public.canvas_students(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  is_latest BOOLEAN NOT NULL DEFAULT FALSE,
  submission_type TEXT,
  submitted_at TIMESTAMPTZ,
  body TEXT,
  url TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  rubric_assessment JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_sha256 TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canvas_course_id, canvas_assignment_id, canvas_student_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_canvas_submission_attempts_assignment
  ON public.canvas_submission_attempts(canvas_course_id, canvas_assignment_id, canvas_student_id);

CREATE TABLE IF NOT EXISTS public.canvas_assignment_rubric_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_course_id BIGINT NOT NULL,
  canvas_assignment_id BIGINT NOT NULL,
  version_hash TEXT NOT NULL,
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  rubric_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canvas_course_id, canvas_assignment_id, version_hash)
);

-- Durable Canvas ingestion and AI grading queues are intentionally
-- separate so one workload cannot block or consume the other's retries.
CREATE TABLE IF NOT EXISTS public.canvas_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_course_id BIGINT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'course_sync',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  requested_by TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_sync_jobs_queue
  ON public.canvas_sync_jobs(status, available_at, created_at);

CREATE TABLE IF NOT EXISTS public.canvas_ai_grading_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('canvas_bachelor', 'canvas_masters')),
  submission_attempt_id UUID NOT NULL REFERENCES public.canvas_submission_attempts(id) ON DELETE CASCADE,
  rubric_version_id UUID REFERENCES public.canvas_assignment_rubric_versions(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_ai_grading_jobs_queue
  ON public.canvas_ai_grading_jobs(status, available_at, created_at);

-- Atomically claim one queued job. SKIP LOCKED allows multiple worker
-- invocations without processing the same job concurrently. Expired
-- processing leases are recoverable after a worker crash.
CREATE OR REPLACE FUNCTION public.claim_canvas_ai_grading_job(
  p_worker_id TEXT,
  p_stale_before TIMESTAMPTZ
)
RETURNS SETOF public.canvas_ai_grading_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.canvas_ai_grading_jobs%ROWTYPE;
BEGIN
  UPDATE public.canvas_ai_grading_jobs
  SET status = 'failed',
      locked_at = NULL,
      locked_by = NULL,
      last_error = COALESCE(last_error, 'Worker lease expired after maximum attempts.'),
      updated_at = NOW()
  WHERE status = 'processing'
    AND locked_at < p_stale_before
    AND attempts >= max_attempts;

  SELECT * INTO v_job
  FROM public.canvas_ai_grading_jobs
  WHERE attempts < max_attempts
    AND (
      (status = 'queued' AND available_at <= NOW())
      OR (status = 'processing' AND locked_at < p_stale_before)
    )
  ORDER BY available_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.canvas_ai_grading_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      locked_at = NOW(),
      locked_by = p_worker_id,
      last_error = NULL,
      updated_at = NOW()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_canvas_ai_grading_job(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canvas_ai_grading_job(TEXT, TIMESTAMPTZ) TO service_role;

CREATE TABLE IF NOT EXISTS public.canvas_ai_grading_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.canvas_ai_grading_jobs(id) ON DELETE CASCADE,
  submission_attempt_id UUID NOT NULL REFERENCES public.canvas_submission_attempts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  rubric_version_id UUID REFERENCES public.canvas_assignment_rubric_versions(id),
  suggested_score NUMERIC,
  suggested_grade TEXT,
  criterion_feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
  overall_feedback TEXT,
  rationale TEXT,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_ai_grading_results_attempt
  ON public.canvas_ai_grading_results(submission_attempt_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_ai_grading_results_job
  ON public.canvas_ai_grading_results(job_id);

-- Persist the AI result and complete its queue job in one transaction. This
-- prevents an expired worker lease from allowing an old worker to overwrite
-- a newer worker's result.
CREATE OR REPLACE FUNCTION public.complete_canvas_ai_grading_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_result JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.canvas_ai_grading_jobs%ROWTYPE;
  v_result_id UUID;
BEGIN
  SELECT * INTO v_job
  FROM public.canvas_ai_grading_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND locked_by = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canvas AI grading worker lease is no longer valid.';
  END IF;

  INSERT INTO public.canvas_ai_grading_results (
    job_id, submission_attempt_id, provider, model, rubric_version_id,
    suggested_score, suggested_grade, criterion_feedback,
    overall_feedback, rationale, raw_response
  ) VALUES (
    v_job.id,
    v_job.submission_attempt_id,
    COALESCE(p_result->>'provider', 'openai'),
    p_result->>'model',
    v_job.rubric_version_id,
    NULLIF(p_result->>'suggested_score', '')::NUMERIC,
    NULLIF(p_result->>'suggested_grade', ''),
    COALESCE(p_result->'criterion_feedback', '[]'::jsonb),
    p_result->>'overall_feedback',
    p_result->>'rationale',
    COALESCE(p_result->'raw_response', '{}'::jsonb)
  )
  ON CONFLICT (job_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    rubric_version_id = EXCLUDED.rubric_version_id,
    suggested_score = EXCLUDED.suggested_score,
    suggested_grade = EXCLUDED.suggested_grade,
    criterion_feedback = EXCLUDED.criterion_feedback,
    overall_feedback = EXCLUDED.overall_feedback,
    rationale = EXCLUDED.rationale,
    raw_response = EXCLUDED.raw_response,
    created_at = NOW()
  RETURNING id INTO v_result_id;

  UPDATE public.canvas_ai_grading_jobs
  SET status = 'completed',
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      updated_at = NOW()
  WHERE id = v_job.id;

  RETURN v_result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_canvas_ai_grading_job(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_canvas_ai_grading_job(UUID, TEXT, JSONB) TO service_role;

CREATE TABLE IF NOT EXISTS public.canvas_examiner_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_result_id UUID NOT NULL REFERENCES public.canvas_ai_grading_results(id),
  submission_attempt_id UUID NOT NULL REFERENCES public.canvas_submission_attempts(id),
  examiner_id UUID NOT NULL REFERENCES public.examiners(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected')),
  review_score NUMERIC,
  review_grade TEXT,
  approved_score NUMERIC,
  approved_grade TEXT,
  examiner_feedback TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_examiner_reviews_attempt
  ON public.canvas_examiner_reviews(submission_attempt_id, created_at DESC);

-- Approved Examiner decisions are immutable. A correction is represented
-- by a new review row, preserving the prior approval as audit evidence.
CREATE OR REPLACE FUNCTION public.prevent_canvas_approved_review_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved Canvas Examiner reviews are immutable; create a new review revision.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_approved_review_immutable ON public.canvas_examiner_reviews;
CREATE TRIGGER canvas_approved_review_immutable
  BEFORE UPDATE OR DELETE ON public.canvas_examiner_reviews
  FOR EACH ROW EXECUTE FUNCTION public.prevent_canvas_approved_review_mutation();


CREATE TABLE IF NOT EXISTS public.canvas_grade_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.canvas_examiner_reviews(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'published', 'failed', 'cancelled')),
  requested_by TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  canvas_grade_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvas_grade_publish_jobs_queue
  ON public.canvas_grade_publish_jobs(status, available_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_grade_publish_jobs_one_active_per_review
  ON public.canvas_grade_publish_jobs(review_id)
  WHERE status IN ('queued', 'processing', 'published');

-- Scope authorization is independent of Final Project assignment links.
CREATE OR REPLACE FUNCTION public.can_access_canvas_assessment_scope(p_scope TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.canvas_assessment_examiners cae
      JOIN public.examiners e ON e.id = cae.examiner_id AND e.is_active = TRUE
      JOIN public.faculty f ON lower(f.email) = lower(e.email)
        AND f.is_active = TRUE AND f.staff_type = 'teaching'
      WHERE cae.scope = p_scope
        AND lower(e.email) = lower(auth.email())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_canvas_assessment_item(
  p_scope TEXT, p_course_id BIGINT, p_assignment_id BIGINT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.is_admin()
    OR (
      public.can_access_canvas_assessment_scope(p_scope)
      AND EXISTS (
        SELECT 1 FROM public.canvas_assessment_courses c
        WHERE c.scope = p_scope AND c.canvas_course_id = p_course_id
          AND c.is_enabled = TRUE
      )
      AND (
        p_assignment_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.canvas_assessment_assignments a
          WHERE a.scope = p_scope AND a.canvas_course_id = p_course_id
            AND a.canvas_assignment_id = p_assignment_id
            AND a.is_assessment = TRUE
        )
      )
    );
$$;

-- Existing 10 production Masters courses are included in the Masters
-- workflow, with their existing 496 assignments enabled by default.
INSERT INTO public.canvas_assessment_courses
  (scope, canvas_course_id, is_enabled, selected_by)
SELECT 'canvas_masters', c.canvas_course_id, TRUE, 'system:migration'
FROM public.canvas_courses c
WHERE c.canvas_course_id IN (201, 328, 385, 421, 427, 432, 434, 443, 447, 548)
ON CONFLICT (scope, canvas_course_id) DO NOTHING;

INSERT INTO public.canvas_assessment_assignments
  (scope, canvas_course_id, canvas_assignment_id, is_assessment, selected_by, selected_at)
SELECT 'canvas_masters', a.canvas_course_id, a.canvas_assignment_id,
       TRUE, 'system:migration', NOW()
FROM public.canvas_assignments a
WHERE a.canvas_course_id IN (201, 328, 385, 421, 427, 432, 434, 443, 447, 548)
ON CONFLICT (scope, canvas_course_id, canvas_assignment_id) DO NOTHING;

-- All new tables use RLS. Admins configure; active assigned Examiners
-- can read only the assessment scope/items assigned to them.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'canvas_assessment_courses','canvas_assessment_assignments',
    'canvas_assessment_config_audit','canvas_assessment_examiners',
    'canvas_submission_attempts','canvas_assignment_rubric_versions',
    'canvas_sync_jobs','canvas_ai_grading_jobs','canvas_ai_grading_results',
    'canvas_examiner_reviews','canvas_grade_publish_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS canvas_assessment_courses_admin_all ON public.canvas_assessment_courses;
CREATE POLICY canvas_assessment_courses_admin_all ON public.canvas_assessment_courses
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS canvas_assessment_courses_examiner_read ON public.canvas_assessment_courses;
CREATE POLICY canvas_assessment_courses_examiner_read ON public.canvas_assessment_courses
  FOR SELECT TO authenticated USING (
    is_enabled AND public.can_access_canvas_assessment_scope(scope)
  );

DROP POLICY IF EXISTS canvas_assessment_assignments_admin_all ON public.canvas_assessment_assignments;
CREATE POLICY canvas_assessment_assignments_admin_all ON public.canvas_assessment_assignments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS canvas_assessment_assignments_examiner_read ON public.canvas_assessment_assignments;
CREATE POLICY canvas_assessment_assignments_examiner_read ON public.canvas_assessment_assignments
  FOR SELECT TO authenticated USING (
    is_assessment AND public.can_access_canvas_assessment_item(scope, canvas_course_id, canvas_assignment_id)
  );

DROP POLICY IF EXISTS canvas_assessment_config_audit_admin_read ON public.canvas_assessment_config_audit;
CREATE POLICY canvas_assessment_config_audit_admin_read ON public.canvas_assessment_config_audit
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS canvas_assessment_examiners_admin_all ON public.canvas_assessment_examiners;
CREATE POLICY canvas_assessment_examiners_admin_all ON public.canvas_assessment_examiners
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS canvas_assessment_examiners_self_read ON public.canvas_assessment_examiners;
CREATE POLICY canvas_assessment_examiners_self_read ON public.canvas_assessment_examiners
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.examiners e
      WHERE e.id = examiner_id AND lower(e.email) = lower(auth.email()))
  );

DROP POLICY IF EXISTS canvas_submission_attempts_scope_read ON public.canvas_submission_attempts;
CREATE POLICY canvas_submission_attempts_scope_read ON public.canvas_submission_attempts
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_assessment_assignments a
      WHERE a.canvas_course_id = canvas_submission_attempts.canvas_course_id
        AND a.canvas_assignment_id = canvas_submission_attempts.canvas_assignment_id
        AND public.can_access_canvas_assessment_item(
          a.scope, a.canvas_course_id, a.canvas_assignment_id
        )
    )
  );

DROP POLICY IF EXISTS canvas_assignment_rubric_versions_scope_read ON public.canvas_assignment_rubric_versions;
CREATE POLICY canvas_assignment_rubric_versions_scope_read ON public.canvas_assignment_rubric_versions
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_assessment_assignments a
      WHERE a.canvas_course_id = canvas_assignment_rubric_versions.canvas_course_id
        AND a.canvas_assignment_id = canvas_assignment_rubric_versions.canvas_assignment_id
        AND public.can_access_canvas_assessment_item(a.scope, a.canvas_course_id, a.canvas_assignment_id)
    )
  );

DROP POLICY IF EXISTS canvas_ai_grading_jobs_scope_read ON public.canvas_ai_grading_jobs;
CREATE POLICY canvas_ai_grading_jobs_scope_read ON public.canvas_ai_grading_jobs
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_submission_attempts s
      WHERE s.id = submission_attempt_id
        AND public.can_access_canvas_assessment_item(
          canvas_ai_grading_jobs.scope, s.canvas_course_id, s.canvas_assignment_id
        )
    )
  );

DROP POLICY IF EXISTS canvas_ai_grading_results_scope_read ON public.canvas_ai_grading_results;
CREATE POLICY canvas_ai_grading_results_scope_read ON public.canvas_ai_grading_results
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_ai_grading_jobs j
      JOIN public.canvas_submission_attempts s ON s.id = j.submission_attempt_id
      WHERE j.id = job_id
        AND public.can_access_canvas_assessment_item(j.scope, s.canvas_course_id, s.canvas_assignment_id)
    )
  );

DROP POLICY IF EXISTS canvas_examiner_reviews_scope_read ON public.canvas_examiner_reviews;
CREATE POLICY canvas_examiner_reviews_scope_read ON public.canvas_examiner_reviews
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_submission_attempts s
      JOIN public.canvas_assessment_assignments a
        ON a.canvas_course_id = s.canvas_course_id
       AND a.canvas_assignment_id = s.canvas_assignment_id
      WHERE s.id = submission_attempt_id
        AND public.can_access_canvas_assessment_item(a.scope, a.canvas_course_id, a.canvas_assignment_id)
    )
  );


-- Allow assigned Examiners to read only the Canvas metadata needed to
-- identify their assessment submissions. This does not grant write access
-- and does not alter existing Masters attendance or outcomes policies.
DROP POLICY IF EXISTS canvas_students_assessment_scope_read ON public.canvas_students;
CREATE POLICY canvas_students_assessment_scope_read ON public.canvas_students
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_submission_attempts s
      JOIN public.canvas_assessment_assignments a
        ON a.canvas_course_id = s.canvas_course_id
       AND a.canvas_assignment_id = s.canvas_assignment_id
      WHERE s.canvas_student_id = canvas_students.id
        AND public.can_access_canvas_assessment_item(a.scope, a.canvas_course_id, a.canvas_assignment_id)
    )
  );

DROP POLICY IF EXISTS canvas_assignments_assessment_scope_read ON public.canvas_assignments;
CREATE POLICY canvas_assignments_assessment_scope_read ON public.canvas_assignments
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_assessment_assignments a
      WHERE a.canvas_course_id = canvas_assignments.canvas_course_id
        AND a.canvas_assignment_id = canvas_assignments.canvas_assignment_id
        AND public.can_access_canvas_assessment_item(a.scope, a.canvas_course_id, a.canvas_assignment_id)
    )
  );

DROP POLICY IF EXISTS canvas_submissions_assessment_scope_read ON public.canvas_submissions;
CREATE POLICY canvas_submissions_assessment_scope_read ON public.canvas_submissions
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_assessment_assignments a
      WHERE a.canvas_course_id = canvas_submissions.canvas_course_id
        AND a.canvas_assignment_id = canvas_submissions.canvas_assignment_id
        AND public.can_access_canvas_assessment_item(a.scope, a.canvas_course_id, a.canvas_assignment_id)
    )
  );


DROP POLICY IF EXISTS canvas_courses_assessment_scope_read ON public.canvas_courses;
CREATE POLICY canvas_courses_assessment_scope_read ON public.canvas_courses
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.canvas_assessment_courses c
      WHERE c.canvas_course_id = canvas_courses.canvas_course_id
        AND c.is_enabled = TRUE
        AND public.can_access_canvas_assessment_scope(c.scope)
    )
  );

-- Evidence files are private. Only server-side service_role code may
-- read or write the bucket; Examiner APIs return authorized signed URLs
-- after checking scope permissions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('canvas-submission-evidence', 'canvas-submission-evidence', FALSE, 52428800)
    ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = 52428800;
  END IF;
END $$;

-- Queue tables and all mutations remain server-side/service-role only.
GRANT SELECT ON public.canvas_assessment_courses,
  public.canvas_assessment_assignments,
  public.canvas_assessment_examiners,
  public.canvas_submission_attempts,
  public.canvas_assignment_rubric_versions,
  public.canvas_ai_grading_jobs,
  public.canvas_ai_grading_results,
  public.canvas_examiner_reviews TO authenticated;
GRANT SELECT ON public.canvas_assessment_config_audit TO authenticated;
GRANT ALL ON public.canvas_assessment_courses,
  public.canvas_assessment_assignments,
  public.canvas_assessment_config_audit,
  public.canvas_assessment_examiners,
  public.canvas_submission_attempts,
  public.canvas_assignment_rubric_versions,
  public.canvas_sync_jobs,
  public.canvas_ai_grading_jobs,
  public.canvas_ai_grading_results,
  public.canvas_examiner_reviews,
  public.canvas_grade_publish_jobs TO service_role;
GRANT EXECUTE ON FUNCTION public.can_access_canvas_assessment_scope(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_canvas_assessment_item(TEXT, BIGINT, BIGINT) TO authenticated, service_role;
