-- Bachelor Case Study Forum participation register.
-- Only verified participation contributes to the 140-point reporting metric.
-- Submission and verification are separate operations.
-- All access is mediated by authorized server-side APIs.

BEGIN;

CREATE TABLE public.bachelor_case_study_forum_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    event_title TEXT NOT NULL
        CHECK (length(trim(event_title)) > 0),

    event_date DATE NOT NULL,

    event_reference TEXT,
    description TEXT,

    created_by_email TEXT NOT NULL,
    updated_by_email TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_bachelor_case_study_forum_events_identity
    ON public.bachelor_case_study_forum_events (
        lower(trim(event_title)),
        event_date
    );

CREATE TABLE public.bachelor_case_study_forum_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    event_id UUID NOT NULL
        REFERENCES public.bachelor_case_study_forum_events(id)
        ON DELETE RESTRICT,

    student_id UUID NOT NULL
        REFERENCES public.students(id)
        ON DELETE RESTRICT,

    participation_role TEXT NOT NULL
        CHECK (participation_role IN ('presenter', 'participant')),

    -- Evidence supporting this student's participation.
    evidence_reference TEXT NOT NULL
        CHECK (length(trim(evidence_reference)) > 0),

    submission_note TEXT,

    -- Points are derived from role and cannot be manually edited.
    points_awarded INTEGER GENERATED ALWAYS AS (
        CASE participation_role
            WHEN 'presenter' THEN 5
            WHEN 'participant' THEN 2
        END
    ) STORED,

    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            verification_status IN ('pending', 'verified', 'rejected')
        ),

    submitted_by_email TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    verified_by_email TEXT,
    verified_at TIMESTAMPTZ,

    rejected_by_email TEXT,
    rejected_at TIMESTAMPTZ,

    review_note TEXT,

    updated_by_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT bachelor_case_study_forum_one_record_per_student_event
        UNIQUE (event_id, student_id),

    CONSTRAINT bachelor_case_study_forum_review_state_check
        CHECK (
            (
                verification_status = 'pending'
                AND verified_by_email IS NULL
                AND verified_at IS NULL
                AND rejected_by_email IS NULL
                AND rejected_at IS NULL
            )
            OR
            (
                verification_status = 'verified'
                AND verified_by_email IS NOT NULL
                AND verified_at IS NOT NULL
                AND rejected_by_email IS NULL
                AND rejected_at IS NULL
            )
            OR
            (
                verification_status = 'rejected'
                AND rejected_by_email IS NOT NULL
                AND rejected_at IS NOT NULL
                AND verified_by_email IS NULL
                AND verified_at IS NULL
            )
        )
);

CREATE INDEX idx_bachelor_case_study_forum_records_student
    ON public.bachelor_case_study_forum_records(student_id);

CREATE INDEX idx_bachelor_case_study_forum_records_event
    ON public.bachelor_case_study_forum_records(event_id);

CREATE INDEX idx_bachelor_case_study_forum_records_verified
    ON public.bachelor_case_study_forum_records(verification_status)
    WHERE verification_status = 'verified';


-- Append-only audit history for event and participation record changes.
CREATE TABLE public.bachelor_case_study_forum_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('event', 'record')),

    entity_id UUID NOT NULL,
    event_id UUID,
    record_id UUID,

    action TEXT NOT NULL
        CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),

    actor_email TEXT NOT NULL,

    old_values JSONB,
    new_values JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bachelor_case_study_forum_audit_entity
    ON public.bachelor_case_study_forum_audit(entity_type, entity_id, created_at);


-- Enforce Bachelor programme scope at the database boundary as well as
-- in the server authorization and reporting APIs.
CREATE OR REPLACE FUNCTION public.validate_bachelor_case_study_forum_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    student_program_id UUID;
BEGIN
    SELECT s.program_id
      INTO student_program_id
      FROM public.students AS s
     WHERE s.id = NEW.student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Case Study Forum student does not exist';
    END IF;

    IF student_program_id NOT IN (
        'bd715dd5-dc5a-414a-98f9-660274fd60e0'::UUID,
        'c266131f-8e5e-4f39-9711-54523d65ea24'::UUID,
        '07bc935a-c743-4cab-b10c-a1d231eaf3e2'::UUID
    ) THEN
        RAISE EXCEPTION 'Case Study Forum records are restricted to Bachelor students';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_bachelor_case_study_forum_student
    BEFORE INSERT OR UPDATE OF student_id
    ON public.bachelor_case_study_forum_records
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_bachelor_case_study_forum_student();


-- Audit trigger records the actor supplied by the trusted API.
-- The API must set updated_by_email to the authenticated caller.
CREATE OR REPLACE FUNCTION public.audit_bachelor_case_study_forum_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    old_row JSONB;
    new_row JSONB;
    row_data JSONB;
    actor TEXT;
    entity UUID;
    related_event UUID;
    related_record UUID;
    operation TEXT;
BEGIN
    operation := TG_OP;

    IF TG_OP = 'INSERT' THEN
        new_row := to_jsonb(NEW);
        row_data := new_row;
    ELSIF TG_OP = 'UPDATE' THEN
        old_row := to_jsonb(OLD);
        new_row := to_jsonb(NEW);
        row_data := new_row;
    ELSE
        old_row := to_jsonb(OLD);
        row_data := old_row;
    END IF;

    actor := row_data ->> 'updated_by_email';

    IF actor IS NULL OR length(trim(actor)) = 0 THEN
        actor := row_data ->> 'created_by_email';
    END IF;

    IF actor IS NULL OR length(trim(actor)) = 0 THEN
        actor := row_data ->> 'submitted_by_email';
    END IF;

    IF actor IS NULL OR length(trim(actor)) = 0 THEN
        RAISE EXCEPTION 'Audit actor email is required';
    END IF;

    entity := (row_data ->> 'id')::UUID;

    IF TG_TABLE_NAME = 'bachelor_case_study_forum_events' THEN
        related_event := entity;
        related_record := NULL;
    ELSE
        related_event := (row_data ->> 'event_id')::UUID;
        related_record := entity;
    END IF;

    INSERT INTO public.bachelor_case_study_forum_audit (
        entity_type,
        entity_id,
        event_id,
        record_id,
        action,
        actor_email,
        old_values,
        new_values
    )
    VALUES (
        CASE
            WHEN TG_TABLE_NAME = 'bachelor_case_study_forum_events'
                THEN 'event'
            ELSE 'record'
        END,
        entity,
        related_event,
        related_record,
        operation,
        lower(trim(actor)),
        old_row,
        new_row
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_bachelor_case_study_forum_events
    AFTER INSERT OR UPDATE OR DELETE
    ON public.bachelor_case_study_forum_events
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_bachelor_case_study_forum_change();

CREATE TRIGGER audit_bachelor_case_study_forum_records
    AFTER INSERT OR UPDATE OR DELETE
    ON public.bachelor_case_study_forum_records
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_bachelor_case_study_forum_change();


-- Audit history must never be edited or deleted.
CREATE OR REPLACE FUNCTION public.prevent_bachelor_case_study_forum_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Case Study Forum audit history is append-only';
END;
$$;

CREATE TRIGGER prevent_bachelor_case_study_forum_audit_mutation
    BEFORE UPDATE OR DELETE
    ON public.bachelor_case_study_forum_audit
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_bachelor_case_study_forum_audit_mutation();


-- Review is a one-way transition: pending -> verified or rejected.
-- Once reviewed, a record cannot be edited or re-reviewed.
CREATE OR REPLACE FUNCTION public.prevent_bachelor_case_study_forum_review_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF OLD.verification_status <> 'pending' THEN
        RAISE EXCEPTION 'Reviewed Case Study Forum records cannot be modified';
    END IF;

    -- Submission evidence and identity are immutable after insertion.
    IF NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.participation_role IS DISTINCT FROM OLD.participation_role
       OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
       OR NEW.submission_note IS DISTINCT FROM OLD.submission_note
       OR NEW.submitted_by_email IS DISTINCT FROM OLD.submitted_by_email
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Submitted Case Study Forum evidence cannot be changed';
    END IF;

    -- A pending record can only receive one final review decision.
    IF NEW.verification_status NOT IN ('verified', 'rejected') THEN
        RAISE EXCEPTION 'A pending Case Study Forum record must receive a review decision';
    END IF;

    IF NEW.updated_by_email IS NULL
       OR length(trim(NEW.updated_by_email)) = 0 THEN
        RAISE EXCEPTION 'Reviewer email is required';
    END IF;

    IF NEW.verification_status = 'verified' THEN
        IF NEW.verified_by_email IS NULL
           OR NEW.verified_at IS NULL
           OR NEW.rejected_by_email IS NOT NULL
           OR NEW.rejected_at IS NOT NULL THEN
            RAISE EXCEPTION 'Verified records require verifier identity and timestamp only';
        END IF;

        IF lower(trim(NEW.verified_by_email))
           <> lower(trim(NEW.updated_by_email)) THEN
            RAISE EXCEPTION 'Verifier identity must match the authenticated reviewer';
        END IF;
    ELSIF NEW.verification_status = 'rejected' THEN
        IF NEW.rejected_by_email IS NULL
           OR NEW.rejected_at IS NULL
           OR NEW.verified_by_email IS NOT NULL
           OR NEW.verified_at IS NOT NULL THEN
            RAISE EXCEPTION 'Rejected records require reviewer identity and timestamp only';
        END IF;

        IF lower(trim(NEW.rejected_by_email))
           <> lower(trim(NEW.updated_by_email)) THEN
            RAISE EXCEPTION 'Reviewer identity must match the authenticated reviewer';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_bachelor_case_study_forum_review_reversal
    BEFORE UPDATE
    ON public.bachelor_case_study_forum_records
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_bachelor_case_study_forum_review_reversal();


-- Prevent truncation as well as row-level modification of audit history.
CREATE TRIGGER prevent_bachelor_case_study_forum_audit_truncate
    BEFORE TRUNCATE
    ON public.bachelor_case_study_forum_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_bachelor_case_study_forum_audit_mutation();


-- Keep all three tables inaccessible to browser-authenticated users.
-- Authorized server APIs use the service role after checking the caller.
ALTER TABLE public.bachelor_case_study_forum_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bachelor_case_study_forum_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bachelor_case_study_forum_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bachelor_case_study_forum_events
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bachelor_case_study_forum_records
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bachelor_case_study_forum_audit
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.bachelor_case_study_forum_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.bachelor_case_study_forum_records TO service_role;
GRANT SELECT ON public.bachelor_case_study_forum_audit TO service_role;

REVOKE ALL ON FUNCTION public.validate_bachelor_case_study_forum_student()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_bachelor_case_study_forum_change()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_bachelor_case_study_forum_audit_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_bachelor_case_study_forum_review_reversal()
    FROM PUBLIC, anon, authenticated;

COMMIT;
