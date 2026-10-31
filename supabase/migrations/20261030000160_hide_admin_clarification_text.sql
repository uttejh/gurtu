-- Clarification prompts can contain details derived from a private user message.
-- Keep them available to the sender but omit them from administrator activity.
create or replace function public.get_admin_family_activity()
returns table (
  id uuid,
  family_id uuid,
  household_id uuid,
  submitted_by_user_id uuid,
  request_id uuid,
  input_type text,
  detected_language text,
  detected_intent text,
  extracted_payload jsonb,
  selected_person_ids uuid[],
  processing_status text,
  result_entity_type text,
  result_entity_id uuid,
  error_code text,
  safe_error_description text,
  created_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz
)
language sql stable security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
  select
    c.id,
    c.family_id,
    c.household_id,
    c.submitted_by_user_id,
    c.request_id,
    c.input_type,
    c.detected_language,
    c.detected_intent,
    case
      when c.extracted_payload is null then null
      else c.extracted_payload - array['original_text', 'summary', 'question']::text[]
    end,
    c.selected_person_ids,
    c.processing_status,
    c.result_entity_type,
    c.result_entity_id,
    c.error_code,
    c.safe_error_description,
    c.created_at,
    c.confirmed_at,
    c.completed_at
  from public.capture_requests c
  where private.can_admin_review_family(c.family_id)
$$;

notify pgrst, 'reload schema';
