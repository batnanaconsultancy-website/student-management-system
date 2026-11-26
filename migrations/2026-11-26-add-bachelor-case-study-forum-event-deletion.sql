BEGIN;

-- For DELETE operations, use the authenticated actor supplied by the
-- trusted server API through the transaction-local setting.
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

    IF TG_OP = 'DELETE' THEN
        actor := current_setting(
            'app.case_study_forum_actor_email',
            true
        );
    ELSE
        actor := row_data ->> 'updated_by_email';

        IF actor IS NULL OR length(trim(actor)) = 0 THEN
            actor := row_data ->> 'created_by_email';
        END IF;

        IF actor IS NULL OR length(trim(actor)) = 0 THEN
            actor := row_data ->> 'submitted_by_email';
        END IF;
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

-- Delete an event and all its participation records atomically.
CREATE OR REPLACE FUNCTION public.delete_bachelor_case_study_forum_event(
    p_event_id UUID,
    p_actor_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_event public.bachelor_case_study_forum_events%ROWTYPE;
    v_actor_email TEXT;
    v_deleted_record_count INTEGER;
BEGIN
    IF p_event_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'A Case Study Forum event ID is required.';
    END IF;

    IF p_actor_email IS NULL OR length(trim(p_actor_email)) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'The authenticated actor email is required.';
    END IF;

    v_actor_email := lower(trim(p_actor_email));

    -- The setting is local to this transaction and is consumed by
    -- the audit triggers for the record and event DELETE operations.
    PERFORM set_config(
        'app.case_study_forum_actor_email',
        v_actor_email,
        true
    );

    SELECT *
      INTO v_event
      FROM public.bachelor_case_study_forum_events
     WHERE id = p_event_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'Case Study Forum event not found.';
    END IF;

    DELETE FROM public.bachelor_case_study_forum_records
     WHERE event_id = p_event_id;

    GET DIAGNOSTICS v_deleted_record_count = ROW_COUNT;

    DELETE FROM public.bachelor_case_study_forum_events
     WHERE id = p_event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'Case Study Forum event could not be deleted.';
    END IF;

    RETURN jsonb_build_object(
        'id', v_event.id,
        'event_title', v_event.event_title,
        'event_date', v_event.event_date,
        'deleted_record_count', v_deleted_record_count
    );
END;
$$;

-- No direct table DELETE grants are added.
-- Only the trusted server-side service role can execute the RPC.
REVOKE ALL ON FUNCTION public.delete_bachelor_case_study_forum_event(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_bachelor_case_study_forum_event(UUID, TEXT)
    TO service_role;

COMMIT;
