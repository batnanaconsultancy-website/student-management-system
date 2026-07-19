-- ============================================================
-- Addresses a new round of Supabase security linter warnings.
-- Two categories, handled differently:
--
-- 1. "Function Search Path Mutable" (5 functions) -- a real,
--    unambiguous fix with no behavior change: pins each
--    function's search_path so it can't be hijacked by an
--    attacker creating same-named objects earlier in the
--    resolution order. Safe to apply as-is.
--
-- 2. "Public/authenticated can execute SECURITY DEFINER
--    function" (is_admin, my_student_id,
--    update_student_status_based_on_season_progress) -- NOT a
--    blind fix. These functions are deliberately SECURITY
--    DEFINER and deliberately used by RLS policies across the
--    schema. Revoking EXECUTE carelessly would break login-gated
--    access for every table that uses them. See the notes by
--    each one below for what's actually safe to change.
-- ============================================================

-- ---- 1. Pin search_path on every flagged function ----
-- (Postgres recommendation: pin to 'public' first, keep pg_temp
-- available for legitimate temp-table use.)

ALTER FUNCTION public.trigger_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_student_status_based_on_season_progress() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.my_student_id() SET search_path = public, pg_temp;

-- update_updated_at_column: this function isn't in schema.sql at all --
-- it's an untracked duplicate of trigger_set_updated_at(), likely a
-- leftover from an earlier iteration or a Supabase project template.
-- Applying the same fix on a best-effort basis (assumes the standard
-- no-argument trigger-function signature). If this errors with
-- "function does not exist" because its real signature differs, check
-- its actual definition in Studio -> Database -> Functions first.
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;


-- ---- 2. SECURITY DEFINER execute grants ----

-- is_admin() and my_student_id() are called FROM WITHIN RLS policies
-- across almost every table (e.g. "students: admin full access" uses
-- is_admin(), "ssp: student reads own progress" uses my_student_id()).
-- Both admins and regular students connect as Postgres role
-- `authenticated` (Supabase doesn't have a separate DB role per app
-- role) -- so `authenticated` MUST keep EXECUTE on both functions, or
-- every one of those policies breaks for every logged-in user,
-- students and admins alike. That part of the warning is a false
-- positive for this schema: it's intentional and required.
--
-- What IS safe to tighten: the `anon` (fully unauthenticated) role.
-- No policy in this schema grants anon access to anything -- every
-- policy requires either is_admin(), my_student_id(), or
-- auth.role() = 'authenticated'. So anon was never able to
-- successfully read anything gated by these functions anyway; revoking
-- its EXECUTE grant just changes an anonymous direct-REST-API caller's
-- failure mode from "empty result" to "permission denied" for tables
-- gated (even partly) by these functions -- same security outcome,
-- tighter surface, and it directly satisfies the linter's "Public Can
-- Execute" finding without touching anything the app depends on.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_student_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_student_id() TO authenticated, service_role;

-- update_student_status_based_on_season_progress() is different: no RLS
-- policy anywhere references it, and nothing in the app code calls it
-- via supabase.rpc(...) as an authenticated/anon user -- it's only ever
-- invoked by scripts/student_management.py using the service-role key
-- (StudentManager defaults to service_role=True). Safe to lock this one
-- down to service_role only.
REVOKE EXECUTE ON FUNCTION public.update_student_status_based_on_season_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_student_status_based_on_season_progress() TO service_role;
