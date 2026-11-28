# Canvas AI Grader: isolated test-database runbook

This runbook is for a **dedicated non-production Supabase/Postgres test database**.
Do not run the migration against the production `supabase-db` container or the
production `sis.amsterdam.tech` application.

## 1. Preconditions

The migration is additive but depends on the existing SIS schema and Supabase
objects. The target test database must already contain:

- `public.canvas_courses`, `public.canvas_assignments`, `public.canvas_students`
- `public.examiners`, `public.faculty`
- `public.is_admin()` and `auth.email()`
- the Supabase `auth` schema; the `storage` schema is needed for the private
  evidence bucket creation

The 10 Masters courses and 496 assignments are seeded only when the target
contains the existing production course/assignment rows for IDs
`201, 328, 385, 421, 427, 432, 434, 443, 447, 548`. A blank database will seed
zero Masters rows; that is not a successful data-coverage test.

## 2. Preflight on the test database

Run against the test database, not production:

```sql
SELECT
  to_regclass('public.canvas_courses') AS canvas_courses,
  to_regclass('public.canvas_assignments') AS canvas_assignments,
  to_regclass('public.canvas_students') AS canvas_students,
  to_regclass('public.examiners') AS examiners,
  to_regclass('public.faculty') AS faculty,
  to_regclass('storage.buckets') AS storage_buckets,
  to_regprocedure('public.is_admin()') AS is_admin_function,
  to_regprocedure('auth.email()') AS auth_email_function;
```

Do not continue if required objects are missing. Use a schema/data clone with
appropriate access controls or prepare the missing baseline schema first.

## 3. Back up and apply

Take a backup of the test database before applying the migration. Apply as the
owner/role authorized to alter the existing SIS tables and create functions
and policies (in the production SIS history, the relevant table owner was
`supabase_admin`; verify the owner in the test database rather than assuming).

```bash
pg_dump -Fc -U <test_db_admin> -d <test_database> \
  -f /root/backups/canvas-ai-grader-test-before.dump

psql -X -v ON_ERROR_STOP=1 -U <test_db_admin> -d <test_database> \
  -f /root/student-management-system/migrations/2026-11-28-create-canvas-ai-grader.sql
```

The commands above are templates: replace placeholders with the test database
connection details. Never substitute the production database name/container.

## 4. Verify migration results

```sql
SELECT scope, COUNT(*) AS selected_courses
FROM public.canvas_assessment_courses
GROUP BY scope
ORDER BY scope;

SELECT scope, COUNT(*) AS assessment_assignments
FROM public.canvas_assessment_assignments
WHERE is_assessment = TRUE
GROUP BY scope
ORDER BY scope;

SELECT c.canvas_course_id, COUNT(a.canvas_assignment_id) AS assignments
FROM public.canvas_assessment_courses c
LEFT JOIN public.canvas_assessment_assignments a
  ON a.scope = c.scope
 AND a.canvas_course_id = c.canvas_course_id
 AND a.is_assessment = TRUE
WHERE c.scope = 'canvas_masters'
GROUP BY c.canvas_course_id
ORDER BY c.canvas_course_id;

SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'canvas_assessment_courses', 'canvas_assessment_assignments',
    'canvas_assessment_examiners', 'canvas_submission_attempts',
    'canvas_assignment_rubric_versions', 'canvas_ai_grading_jobs',
    'canvas_ai_grading_results', 'canvas_examiner_reviews',
    'canvas_grade_publish_jobs'
  )
ORDER BY c.relname;

SELECT
  has_function_privilege('anon', 'public.claim_canvas_ai_grading_job(text,timestamp with time zone)', 'EXECUTE') AS anon_can_claim,
  has_function_privilege('authenticated', 'public.claim_canvas_ai_grading_job(text,timestamp with time zone)', 'EXECUTE') AS authenticated_can_claim,
  has_function_privilege('service_role', 'public.claim_canvas_ai_grading_job(text,timestamp with time zone)', 'EXECUTE') AS service_role_can_claim,
  has_function_privilege('anon', 'public.complete_canvas_ai_grading_job(uuid,text,jsonb)', 'EXECUTE') AS anon_can_complete,
  has_function_privilege('authenticated', 'public.complete_canvas_ai_grading_job(uuid,text,jsonb)', 'EXECUTE') AS authenticated_can_complete,
  has_function_privilege('service_role', 'public.complete_canvas_ai_grading_job(uuid,text,jsonb)', 'EXECUTE') AS service_role_can_complete;
```

For a full copy of the current production Canvas data, expect 10 Masters courses
and 496 enabled Masters assignments. Also verify that the 195 other discovered
courses are available for Bachelor selection but have not been automatically
enabled, and that no Bachelor assignment is enabled by default.

## 5. Worker environment and execution

On the test application only, configure server-side environment variables:

```dotenv
OPENAI_API_KEY=<test-project-api-key>
OPENAI_MODEL=gpt-6.2-sol
CANVAS_AI_WORKER_SECRET=<separate-random-test-secret>
```

Use a separate test secret. Never copy production API keys or worker secrets
into a test file, Git, browser configuration, or logs. Do not enable a live
scheduler until a test job and its result have been reviewed.

The unit tests use a mocked Responses API implementation and do not send
requests to OpenAI. Run them with:

```bash
npm run test:canvas-ai-grader
```

A database-backed worker test requires the migration to be applied to the
isolated test database and a test job with a valid captured rubric and text
submission. The worker's HTTP endpoint is authenticated by the worker secret.

## 6. Production remains a separate approval

Do not apply this migration to production, change production environment
variables, restart PM2, create a production scheduler, or submit real student
work to OpenAI until the isolated test results and a separate production
change plan have been reviewed and explicitly approved.
