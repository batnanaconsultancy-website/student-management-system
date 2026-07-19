-- ============================================================
-- Adds student_class to distinguish 'Regular' students from
-- 'Code Academy' students, so the admin dashboard can filter
-- between the two.
-- ============================================================

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS student_class TEXT NOT NULL DEFAULT 'Regular';

ALTER TABLE students
    ADD CONSTRAINT students_student_class_check
    CHECK (student_class IN ('Regular', 'Code Academy'));

CREATE INDEX IF NOT EXISTS idx_students_student_class ON students(student_class);
