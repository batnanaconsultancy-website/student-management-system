-- ============================================================
-- Diagnostic: check current grants and RLS policies on the table
-- ============================================================
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'student_duplicate_project_report';

SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'student_duplicate_project_report';

-- ============================================================
-- Fix: tables created via raw SQL (not the Table Editor UI) don't
-- automatically get GRANTed to Supabase's standard roles. The RLS
-- policy alone isn't enough -- the role also needs the underlying
-- Postgres privilege, or you get "permission denied for table" even
-- with a correct policy in place.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON student_duplicate_project_report TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON student_duplicate_project_report TO service_role;

-- Re-check after granting -- should now show rows for both roles
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'student_duplicate_project_report';
