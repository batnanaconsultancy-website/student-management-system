-- ============================================================
-- Final Project Assessment module -- Phase 1 data model.
--
-- Builds on existing infrastructure rather than duplicating it:
--   - Reuses the existing generic `audit_log` table for the audit
--     trail (Section 20) instead of a new one.
--   - Reuses the existing `admin_notifications` table for the Admin
--     Inbox integration (Section 8) -- see the separate
--     "notify admin on submission" trigger at the bottom of this file.
--   - "Season 04 completed" is read from the existing `seasons` /
--     `student_season_progress` tables (same 75%-threshold rule the
--     rest of the app already uses), not duplicated here. This
--     migration only adds an admin CONFIRMATION flag (the explicit
--     admin sign-off the spec asks for, which can be an override).
--
-- Role model: examiner is an independent capability, not a
-- replacement for admin/user. An email can exist in BOTH the
-- `admin` table and this `examiners` table at once (an admin who is
-- also an examiner); it can also exist ONLY in `examiners` (a pure
-- examiner, not an admin, not necessarily a student). Every admin has
-- full access to every examiner/assignment record -- no per-admin
-- scoping, matching how every other admin-facing table in this app
-- already works.
-- ============================================================


-- ── my_examiner_id() helper ─────────────────────────────────
-- Mirrors the existing is_admin() / my_student_id() helper-function
-- convention used throughout this schema. Confirmed against the
-- actual live definitions: both is_admin() and my_student_id() use
-- Supabase's auth.email() built-in (not auth.jwt() ->> 'email'), so
-- this does too. Unlike those two, this compares case-insensitively
-- (lower() on both sides) as a small extra safety margin for a brand
-- new table -- harmless even if auth.email() is already lowercase.
-- ============================================================
-- FINAL PROJECT ASSESSMENT MODULE
-- Corrected Phase 1 migration
-- ============================================================


-- ============================================================
-- 1. EXAMINERS
-- ============================================================

CREATE TABLE IF NOT EXISTS examiners (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_examiners_email
    ON examiners(lower(email));


-- ============================================================
-- 2. EXAMINER HELPER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION my_examiner_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT id
    FROM examiners
    WHERE lower(email) = lower(auth.email())
      AND is_active;
$$;


-- ============================================================
-- 3. LOWERCASE EXAMINER EMAIL
-- ============================================================

CREATE OR REPLACE FUNCTION lowercase_examiner_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.email := lower(NEW.email);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lowercase_examiner_email_trigger
    ON examiners;

CREATE TRIGGER lowercase_examiner_email_trigger
    BEFORE INSERT OR UPDATE ON examiners
    FOR EACH ROW
    EXECUTE FUNCTION lowercase_examiner_email();


-- ============================================================
-- 4. EXAMINER RLS
-- ============================================================

ALTER TABLE examiners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "examiners: admin full access"
    ON examiners;

CREATE POLICY "examiners: admin full access"
    ON examiners
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "examiners: examiner reads own"
    ON examiners;

CREATE POLICY "examiners: examiner reads own"
    ON examiners
    FOR SELECT
    USING (
        lower(email) = lower(auth.email())
    );


GRANT SELECT, INSERT, UPDATE, DELETE
    ON examiners TO authenticated;

GRANT ALL
    ON examiners TO service_role;


-- ============================================================
-- 5. EXAMINER UPDATED_AT TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at_examiners
    ON examiners;

CREATE TRIGGER set_updated_at_examiners
    BEFORE UPDATE ON examiners
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 6. FINAL PROJECT ASSIGNMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS final_project_assignments (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id                  UUID NOT NULL
                                REFERENCES students(id)
                                ON DELETE CASCADE,

    season04_confirmed         BOOLEAN NOT NULL DEFAULT FALSE,
    season04_override          BOOLEAN NOT NULL DEFAULT FALSE,
    season04_confirmed_by      TEXT,
    season04_confirmed_at      TIMESTAMPTZ,

    assessment_activated       BOOLEAN NOT NULL DEFAULT FALSE,
    activated_by                TEXT,
    activated_at                TIMESTAMPTZ,

    archived                    BOOLEAN NOT NULL DEFAULT FALSE,
    archived_by                 TEXT,
    archived_at                 TIMESTAMPTZ,

    created_by                  TEXT NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (student_id)
);

CREATE INDEX IF NOT EXISTS idx_fpa_student_id
    ON final_project_assignments(student_id);

CREATE INDEX IF NOT EXISTS idx_fpa_archived
    ON final_project_assignments(archived);


-- ============================================================
-- 7. FINAL PROJECT ASSIGNMENT EXAMINERS
-- ============================================================

CREATE TABLE IF NOT EXISTS final_project_assignment_examiners (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    assignment_id  UUID NOT NULL
                   REFERENCES final_project_assignments(id)
                   ON DELETE CASCADE,

    examiner_id    UUID NOT NULL
                   REFERENCES examiners(id)
                   ON DELETE CASCADE,

    assigned_by    TEXT NOT NULL,
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (assignment_id, examiner_id)
);

CREATE INDEX IF NOT EXISTS idx_fpae_assignment
    ON final_project_assignment_examiners(assignment_id);

CREATE INDEX IF NOT EXISTS idx_fpae_examiner
    ON final_project_assignment_examiners(examiner_id);


-- ============================================================
-- 8. FINAL PROJECT ASSIGNMENTS RLS
-- ============================================================

ALTER TABLE final_project_assignments
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "final_project_assignments: admin full access"
    ON final_project_assignments;

CREATE POLICY "final_project_assignments: admin full access"
    ON final_project_assignments
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "final_project_assignments: examiner reads own"
    ON final_project_assignments;

CREATE POLICY "final_project_assignments: examiner reads own"
    ON final_project_assignments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_assignment_examiners fpae
            WHERE fpae.assignment_id = final_project_assignments.id
              AND fpae.examiner_id = my_examiner_id()
        )
    );


DROP POLICY IF EXISTS "final_project_assignments: student reads own"
    ON final_project_assignments;

CREATE POLICY "final_project_assignments: student reads own"
    ON final_project_assignments
    FOR SELECT
    USING (
        student_id = my_student_id()
    );


GRANT SELECT, INSERT, UPDATE
    ON final_project_assignments TO authenticated;

GRANT ALL
    ON final_project_assignments TO service_role;


-- ============================================================
-- 9. FINAL PROJECT ASSIGNMENT EXAMINERS RLS
-- ============================================================

ALTER TABLE final_project_assignment_examiners
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "fpae: admin full access"
    ON final_project_assignment_examiners;

CREATE POLICY "fpae: admin full access"
    ON final_project_assignment_examiners
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "fpae: examiner reads own links"
    ON final_project_assignment_examiners;

CREATE POLICY "fpae: examiner reads own links"
    ON final_project_assignment_examiners
    FOR SELECT
    USING (
        examiner_id = my_examiner_id()
    );


GRANT SELECT, INSERT, DELETE
    ON final_project_assignment_examiners TO authenticated;

GRANT ALL
    ON final_project_assignment_examiners TO service_role;


-- ============================================================
-- 10. FINAL PROJECT ASSIGNMENT UPDATED_AT
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at_fpa
    ON final_project_assignments;

CREATE TRIGGER set_updated_at_fpa
    BEFORE UPDATE ON final_project_assignments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 11. FINAL PROJECT CRITERIA
-- ============================================================

CREATE TABLE IF NOT EXISTS final_project_criteria (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    assessment_type  TEXT NOT NULL
                     CHECK (
                         assessment_type IN (
                             'submission',
                             'presentation'
                         )
                     ),

    label            TEXT NOT NULL,

    max_grade        NUMERIC NOT NULL DEFAULT 100
                     CHECK (max_grade > 0),

    display_order    INTEGER NOT NULL DEFAULT 0,

    is_active        BOOLEAN NOT NULL DEFAULT TRUE,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fpc_type
    ON final_project_criteria(
        assessment_type,
        display_order
    );


-- ============================================================
-- 12. CRITERIA RLS
-- ============================================================

ALTER TABLE final_project_criteria
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "final_project_criteria: admin full access"
    ON final_project_criteria;

CREATE POLICY "final_project_criteria: admin full access"
    ON final_project_criteria
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "final_project_criteria: examiner reads active"
    ON final_project_criteria;

CREATE POLICY "final_project_criteria: examiner reads active"
    ON final_project_criteria
    FOR SELECT
    USING (
        is_active
        AND my_examiner_id() IS NOT NULL
    );


GRANT SELECT, INSERT, UPDATE, DELETE
    ON final_project_criteria TO authenticated;

GRANT ALL
    ON final_project_criteria TO service_role;


DROP TRIGGER IF EXISTS set_updated_at_fpc
    ON final_project_criteria;

CREATE TRIGGER set_updated_at_fpc
    BEFORE UPDATE ON final_project_criteria
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 13. STARTER CRITERIA
-- ============================================================

INSERT INTO final_project_criteria (
    assessment_type,
    label,
    max_grade,
    display_order
)
VALUES
    ('submission', 'Code Quality', 100, 1),
    ('submission', 'Functionality', 100, 2),
    ('submission', 'Documentation', 100, 3),
    ('submission', 'Adherence to Requirements', 100, 4),

    ('presentation', 'Clarity of Presentation', 100, 1),
    ('presentation', 'Technical Depth', 100, 2),
    ('presentation', 'Q&A Handling', 100, 3),
    ('presentation', 'Time Management', 100, 4)
ON CONFLICT DO NOTHING;


-- ============================================================
-- 14. FINAL PROJECT SUBMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS final_project_submissions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    assignment_id     UUID NOT NULL
                      REFERENCES final_project_assignments(id)
                      ON DELETE CASCADE,

    assessment_type   TEXT NOT NULL
                      CHECK (
                          assessment_type IN (
                              'submission',
                              'presentation'
                          )
                      ),

    status            TEXT NOT NULL DEFAULT 'NOT_ASSIGNED'
                      CHECK (
                          status IN (
                              'NOT_ASSIGNED',
                              'ASSIGNED',
                              'ACTIVATED',
                              'IN_PROGRESS',
                              'SUBMITTED',
                              'ARCHIVED'
                          )
                      ),

    average_grade     NUMERIC,

    submitted_by      UUID
                      REFERENCES examiners(id),

    submitted_at      TIMESTAMPTZ,

    reopened_by       TEXT,
    reopened_at       TIMESTAMPTZ,
    reopen_reason     TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (assignment_id, assessment_type)
);

CREATE INDEX IF NOT EXISTS idx_fps_assignment
    ON final_project_submissions(assignment_id);

CREATE INDEX IF NOT EXISTS idx_fps_status
    ON final_project_submissions(status);


-- ============================================================
-- 15. SUBMISSIONS RLS
-- ============================================================

ALTER TABLE final_project_submissions
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "final_project_submissions: admin full access"
    ON final_project_submissions;

CREATE POLICY "final_project_submissions: admin full access"
    ON final_project_submissions
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "final_project_submissions: examiner reads own"
    ON final_project_submissions;

CREATE POLICY "final_project_submissions: examiner reads own"
    ON final_project_submissions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_assignment_examiners fpae
            WHERE fpae.assignment_id =
                  final_project_submissions.assignment_id
              AND fpae.examiner_id = my_examiner_id()
        )
    );


DROP POLICY IF EXISTS "final_project_submissions: examiner updates own while editable"
    ON final_project_submissions;

CREATE POLICY "final_project_submissions: examiner updates own while editable"
    ON final_project_submissions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_assignment_examiners fpae
            WHERE fpae.assignment_id =
                  final_project_submissions.assignment_id
              AND fpae.examiner_id = my_examiner_id()
        )
        AND (
            status NOT IN ('SUBMITTED', 'ARCHIVED')
            OR (
                reopened_at IS NOT NULL
                AND reopened_at > submitted_at
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM final_project_assignment_examiners fpae
            WHERE fpae.assignment_id =
                  final_project_submissions.assignment_id
              AND fpae.examiner_id = my_examiner_id()
        )
    );


DROP POLICY IF EXISTS "final_project_submissions: student reads own"
    ON final_project_submissions;

CREATE POLICY "final_project_submissions: student reads own"
    ON final_project_submissions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_assignments fpa
            WHERE fpa.id =
                  final_project_submissions.assignment_id
              AND fpa.student_id = my_student_id()
        )
    );


GRANT SELECT, INSERT, UPDATE
    ON final_project_submissions TO authenticated;

GRANT ALL
    ON final_project_submissions TO service_role;


DROP TRIGGER IF EXISTS set_updated_at_fps
    ON final_project_submissions;

CREATE TRIGGER set_updated_at_fps
    BEFORE UPDATE ON final_project_submissions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 16. FINAL PROJECT GRADES
-- ============================================================

CREATE TABLE IF NOT EXISTS final_project_grades (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    submission_id  UUID NOT NULL
                   REFERENCES final_project_submissions(id)
                   ON DELETE CASCADE,

    criterion_id   UUID NOT NULL
                   REFERENCES final_project_criteria(id),

    grade          NUMERIC NOT NULL
                   CHECK (grade >= 0),

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (submission_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_fpg_submission
    ON final_project_grades(submission_id);


-- ============================================================
-- 17. GRADES RLS
-- ============================================================

ALTER TABLE final_project_grades
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "final_project_grades: admin full access"
    ON final_project_grades;

CREATE POLICY "final_project_grades: admin full access"
    ON final_project_grades
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "final_project_grades: examiner manages own submission's grades"
    ON final_project_grades;

CREATE POLICY "final_project_grades: examiner manages own submission's grades"
    ON final_project_grades
    FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_submissions fps
            JOIN final_project_assignment_examiners fpae
              ON fpae.assignment_id = fps.assignment_id
            WHERE fps.id = final_project_grades.submission_id
              AND fpae.examiner_id = my_examiner_id()
              AND (
                  fps.status NOT IN ('SUBMITTED', 'ARCHIVED')
                  OR (
                      fps.reopened_at IS NOT NULL
                      AND fps.reopened_at > fps.submitted_at
                  )
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM final_project_submissions fps
            JOIN final_project_assignment_examiners fpae
              ON fpae.assignment_id = fps.assignment_id
            WHERE fps.id = final_project_grades.submission_id
              AND fpae.examiner_id = my_examiner_id()
        )
    );


DROP POLICY IF EXISTS "final_project_grades: student reads own"
    ON final_project_grades;

CREATE POLICY "final_project_grades: student reads own"
    ON final_project_grades
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_submissions fps
            JOIN final_project_assignments fpa
              ON fpa.id = fps.assignment_id
            WHERE fps.id = final_project_grades.submission_id
              AND fpa.student_id = my_student_id()
        )
    );


GRANT SELECT, INSERT, UPDATE, DELETE
    ON final_project_grades TO authenticated;

GRANT ALL
    ON final_project_grades TO service_role;


DROP TRIGGER IF EXISTS set_updated_at_fpg
    ON final_project_grades;

CREATE TRIGGER set_updated_at_fpg
    BEFORE UPDATE ON final_project_grades
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- 18. FINAL PROJECT SIGNATURES
-- ============================================================

CREATE TABLE IF NOT EXISTS final_project_signatures (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    submission_id  UUID NOT NULL
                   REFERENCES final_project_submissions(id)
                   ON DELETE CASCADE,

    examiner_id    UUID NOT NULL
                   REFERENCES examiners(id),

    signature_text TEXT NOT NULL,

    signed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (submission_id, examiner_id)
);

CREATE INDEX IF NOT EXISTS idx_fps_sig_submission
    ON final_project_signatures(submission_id);


-- ============================================================
-- 19. SIGNATURES RLS
-- ============================================================

ALTER TABLE final_project_signatures
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "final_project_signatures: admin full access"
    ON final_project_signatures;

CREATE POLICY "final_project_signatures: admin full access"
    ON final_project_signatures
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());


DROP POLICY IF EXISTS "final_project_signatures: examiner manages own signature"
    ON final_project_signatures;

CREATE POLICY "final_project_signatures: examiner manages own signature"
    ON final_project_signatures
    FOR ALL
    USING (
        examiner_id = my_examiner_id()
    )
    WITH CHECK (
        examiner_id = my_examiner_id()
    );


DROP POLICY IF EXISTS "final_project_signatures: student reads own"
    ON final_project_signatures;

CREATE POLICY "final_project_signatures: student reads own"
    ON final_project_signatures
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM final_project_submissions fps
            JOIN final_project_assignments fpa
              ON fpa.id = fps.assignment_id
            WHERE fps.id = final_project_signatures.submission_id
              AND fpa.student_id = my_student_id()
        )
    );


GRANT SELECT, INSERT, UPDATE, DELETE
    ON final_project_signatures TO authenticated;

GRANT ALL
    ON final_project_signatures TO service_role;


-- ============================================================
-- 20. DONE
-- ============================================================

-- Application-layer work remains:
--   - Extend useAuth()/middleware with examiner capability
--   - Admin UI
--   - Examiner UI
--   - Student UI
--   - audit_log integration
--   - admin_notifications integration