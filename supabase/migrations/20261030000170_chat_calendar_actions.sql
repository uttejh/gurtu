alter table public.capture_requests
  drop constraint if exists capture_requests_detected_intent_check;

alter table public.capture_requests
  add constraint capture_requests_detected_intent_check
  check (detected_intent is null or detected_intent in (
    'save_memory', 'save_item_location', 'create_list', 'add_list_items',
    'update_list_item', 'remove_list_item', 'create_event', 'update_event',
    'delete_event', 'clarify'
  ));

alter table public.operation_requests drop constraint if exists operation_requests_record_type_check;
alter table public.operation_requests add constraint operation_requests_record_type_check
  check (record_type in ('memory', 'item', 'list', 'event', 'list_item_add', 'list_item_update', 'list_item_remove', 'event_update', 'event_delete'));

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in (
    'memory_saved', 'item_location_changed', 'list_created', 'list_item_added',
    'list_item_completed', 'list_item_uncompleted', 'list_item_removed',
    'event_created', 'event_updated', 'event_deleted'
  ));

create or replace function public.update_gurtu_capture_interpretation(
  p_request_id uuid,
  p_original_transcript text,
  p_corrected_transcript text,
  p_detected_language text,
  p_detected_intent text,
  p_extracted_payload jsonb,
  p_selected_person_ids uuid[],
  p_processing_status text
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_family uuid;
  v_capture_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select family_id into v_family from public.profiles where user_id = v_user;
  if p_request_id is null or length(coalesce(p_original_transcript, '')) not between 1 and 8000
    or length(coalesce(p_corrected_transcript, '')) not between 1 and 8000
    or length(coalesce(p_detected_language, '')) not between 2 and 20
    or p_detected_intent is null or p_detected_intent not in ('save_memory','save_item_location','create_list','add_list_items','update_list_item','remove_list_item','create_event','update_event','delete_event','clarify')
    or p_extracted_payload is null or jsonb_typeof(p_extracted_payload) <> 'object'
    or p_extracted_payload->>'action' <> p_detected_intent
    or p_processing_status is null or p_processing_status not in ('awaiting_confirmation','needs_clarification')
    or cardinality(coalesce(p_selected_person_ids, '{}')) > 100 then
    raise exception 'invalid capture interpretation' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_selected_person_ids, '{}')) x
    left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person selection is not in this family' using errcode = '42501'; end if;
  update public.capture_requests set
    corrected_transcript = p_corrected_transcript,
    detected_language = p_detected_language,
    detected_intent = p_detected_intent,
    extracted_payload = p_extracted_payload,
    selected_person_ids = coalesce(p_selected_person_ids, '{}'),
    processing_status = p_processing_status,
    error_code = null,
    safe_error_description = null,
    updated_at = now()
  where submitted_by_user_id = v_user and family_id = v_family and request_id = p_request_id
    and original_transcript = p_original_transcript
    and processing_status in ('received','transcribing','interpretation_failed','needs_clarification','awaiting_confirmation','operation_failed')
    and not exists (select 1 from public.operation_requests o where o.user_id = v_user and o.request_id = p_request_id and o.record_id is not null)
  returning id into v_capture_id;
  if v_capture_id is null then raise exception 'capture not available' using errcode = '40001'; end if;
  return v_capture_id;
end
$$;

revoke all on function public.update_gurtu_capture_interpretation(uuid, text, text, text, text, jsonb, uuid[], text) from public, anon;
grant execute on function public.update_gurtu_capture_interpretation(uuid, text, text, text, text, jsonb, uuid[], text) to authenticated;

create or replace function public.delete_gurtu_event(p_event_id uuid, p_request_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_owner uuid;
  v_event_id uuid;
  v_old_type text;
  v_old_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_event_id is null or p_request_id is null then raise exception 'invalid event deletion' using errcode = '22023'; end if;
  select household_id into v_household from public.profiles where user_id = v_user;
  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, 'event_delete') on conflict do nothing;
  select record_type, record_id into v_old_type, v_old_id
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_old_type <> 'event_delete' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_old_id is not null then return v_old_id; end if;
  select owner_household_id into v_owner from public.events where id = p_event_id for update;
  if v_owner is null or v_owner <> v_household then raise exception 'event is not editable by this household' using errcode = '42501'; end if;
  delete from public.events where id = p_event_id and owner_household_id = v_household returning id into v_event_id;
  if v_event_id is null then raise exception 'event is no longer available' using errcode = 'P0002'; end if;
  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
    values (v_household, v_user, 'event_deleted', 'event', v_event_id);
  update public.operation_requests set record_id = v_event_id where user_id = v_user and request_id = p_request_id;
  return v_event_id;
end
$$;

revoke all on function public.delete_gurtu_event(uuid, uuid) from public, anon;
grant execute on function public.delete_gurtu_event(uuid, uuid) to authenticated;
