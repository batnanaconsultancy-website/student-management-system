-- ============================================================
-- Fixes "permission denied for table X" errors on tables created
-- by recent migrations (guidance_requests, and proactively
-- student_duplicate_project_report).
--
-- Root cause: every pre-existing table in this schema was
-- originally created through Supabase's Table Editor UI, which
-- auto-grants table privileges to anon/authenticated/service_role
-- alongside creating the table. Tables created via raw SQL
-- (CREATE TABLE in a migration) do NOT get that automatic grant --
-- RLS policies and table-level GRANTs are two independent gates in
-- Postgres. A policy permitting a row is irrelevant if the role
-- doesn't have the base privilege to attempt the operation at all,
-- which is exactly what "permission denied for table X" means (as
-- opposed to an RLS rejection, which reads differently).
--
-- RLS policies remain the actual fine-grained access control here --
-- these grants are just the coarse on/off switch Postgres requires
-- underneath them.
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON guidance_requests TO authenticated;
GRANT ALL ON guidance_requests TO service_role;

GRANT SELECT ON student_duplicate_project_report TO authenticated;
GRANT ALL ON student_duplicate_project_report TO service_role;
