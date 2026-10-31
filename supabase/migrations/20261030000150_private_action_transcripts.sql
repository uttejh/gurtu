-- Keep capture transcripts readable by their author while preserving MFA-gated
-- family activity review without exposing raw submitted text to administrators.
revoke select on public.capture_requests from authenticated;

create function public.get_own_capture_requests()
returns setof public.capture_requests
language sql stable security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
  select c.* from public.capture_requests c
  where c.submitted_by_user_id = auth.uid()
    and c.household_id = private.current_household_id()
$$;

create function public.get_admin_family_activity()
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
      else c.extracted_payload - array['original_text', 'summary']::text[]
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

revoke all on function public.get_own_capture_requests(), public.get_admin_family_activity() from public, anon;
grant execute on function public.get_own_capture_requests(), public.get_admin_family_activity() to authenticated;

comment on function public.get_own_capture_requests() is
  'Returns capture records, including transcripts, only for the submitting user.';
comment on function public.get_admin_family_activity() is
  'Returns MFA-gated family activity metadata without original/corrected transcripts or raw memory text.';

create or replace function public.log_gurtu_admin_action(p_action text, p_capture_request_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_admin uuid := auth.uid();
  v_family uuid := private.current_family_id();
  v_id uuid;
begin
  if not private.is_global_admin_aal2() then raise exception 'administrator MFA is required' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('family_activity_search', 'capture_viewed') then
    raise exception 'invalid administrator action' using errcode = '22023';
  end if;
  if p_capture_request_id is not null and not exists (
    select 1 from public.capture_requests c where c.id = p_capture_request_id and c.family_id = v_family
  ) then raise exception 'capture request is not available' using errcode = '42501'; end if;
  insert into public.admin_audit_log(family_id, admin_user_id, action, target_capture_request_id)
    values (v_family, v_admin, p_action, p_capture_request_id) returning id into v_id;
  return v_id;
end
$$;

notify pgrst, 'reload schema';
