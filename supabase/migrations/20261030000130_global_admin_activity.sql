create table private.global_administrators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by_user_id uuid references auth.users(id) on delete set null
);
alter table private.global_administrators enable row level security;
revoke all on private.global_administrators from public, anon, authenticated;

create or replace function private.has_global_admin_role()
returns boolean
language sql stable security definer
set search_path = pg_catalog, private
set row_security = off
as $$
  select auth.uid() is not null and exists (
    select 1 from private.global_administrators g where g.user_id = auth.uid()
  )
$$;

create or replace function private.is_global_admin_aal2()
returns boolean
language sql stable security definer
set search_path = pg_catalog, private
set row_security = off
as $$
  select private.has_global_admin_role() and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;

create or replace function private.can_admin_review_family(p_family_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
  select p_family_id = private.current_family_id() and private.is_global_admin_aal2()
$$;

create or replace function private.can_admin_review_household(p_household_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
  select private.is_global_admin_aal2() and exists (
    select 1 from public.households h
    where h.id = p_household_id and h.family_id = private.current_family_id()
  )
$$;

create or replace function public.has_gurtu_global_admin_role()
returns boolean
language sql stable security definer
set search_path = pg_catalog, private
set row_security = off
as $$ select private.has_global_admin_role() $$;

revoke all on function private.has_global_admin_role(), private.is_global_admin_aal2(),
  private.can_admin_review_family(uuid), private.can_admin_review_household(uuid),
  public.has_gurtu_global_admin_role() from public, anon;
grant execute on function private.has_global_admin_role(), private.is_global_admin_aal2(),
  private.can_admin_review_family(uuid), private.can_admin_review_household(uuid),
  public.has_gurtu_global_admin_role() to authenticated;

create table public.capture_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  household_id uuid not null,
  submitted_by_user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  input_type text not null check (input_type in ('text', 'voice')),
  original_transcript text check (original_transcript is null or length(original_transcript) <= 8000),
  corrected_transcript text check (corrected_transcript is null or length(corrected_transcript) <= 8000),
  detected_language text not null default 'und' check (length(detected_language) between 2 and 20),
  detected_intent text check (detected_intent is null or detected_intent in (
    'save_memory', 'save_item_location', 'create_list', 'add_list_items',
    'update_list_item', 'remove_list_item', 'create_event', 'update_event', 'clarify'
  )),
  extracted_payload jsonb check (extracted_payload is null or jsonb_typeof(extracted_payload) = 'object'),
  selected_person_ids uuid[] not null default '{}',
  processing_status text not null default 'received' check (processing_status in (
    'transcribing', 'received', 'interpreting', 'transcription_failed', 'interpretation_failed',
    'needs_clarification', 'awaiting_confirmation', 'operation_pending', 'operation_failed',
    'succeeded', 'cancelled'
  )),
  result_entity_type text check (result_entity_type is null or result_entity_type in ('memory', 'item', 'list', 'event')),
  result_entity_id uuid,
  error_code text check (error_code is null or length(error_code) <= 64),
  safe_error_description text check (safe_error_description is null or length(safe_error_description) <= 500),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (household_id, family_id) references public.households(id, family_id) on delete cascade,
  unique (submitted_by_user_id, request_id)
);
alter table public.capture_requests enable row level security;
revoke all on public.capture_requests from public, anon, authenticated;
grant select on public.capture_requests to authenticated;
create policy capture_requests_read_owner on public.capture_requests for select to authenticated
  using (submitted_by_user_id = auth.uid() and household_id = private.current_household_id());
create policy capture_requests_read_admin on public.capture_requests for select to authenticated
  using (private.can_admin_review_family(family_id));

create index capture_requests_household_created_idx on public.capture_requests(household_id, created_at desc);
create index capture_requests_user_created_idx on public.capture_requests(submitted_by_user_id, created_at desc);
create index capture_requests_status_created_idx on public.capture_requests(processing_status, created_at desc);
create index capture_requests_intent_created_idx on public.capture_requests(detected_intent, created_at desc);
create index capture_requests_family_created_idx on public.capture_requests(family_id, created_at desc);

alter table public.item_location_history
  add column corrected_by_admin_user_id uuid references auth.users(id) on delete set null,
  add column correction_of_history_id uuid references public.item_location_history(id) on delete set null,
  add column correction_reason text check (correction_reason is null or length(correction_reason) <= 500);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'family_activity_search', 'capture_viewed', 'transcript_viewed',
    'retry_succeeded', 'retry_failed', 'retry_reconciled',
    'people_corrected', 'location_corrected'
  )),
  target_capture_request_id uuid references public.capture_requests(id) on delete set null,
  target_record_type text,
  target_record_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy admin_audit_log_read_admin on public.admin_audit_log for select to authenticated
  using (private.can_admin_review_family(family_id));
create index admin_audit_family_created_idx on public.admin_audit_log(family_id, created_at desc);
create index admin_audit_target_created_idx on public.admin_audit_log(target_capture_request_id, created_at desc);

create policy profiles_read_global_admin on public.profiles for select to authenticated
  using (private.can_admin_review_family(family_id));
create policy people_read_global_admin on public.people for select to authenticated
  using (private.can_admin_review_family(family_id));
create policy memories_read_global_admin on public.memories for select to authenticated
  using (private.can_admin_review_household(household_id));
create policy memory_people_read_global_admin on public.memory_people for select to authenticated
  using (exists (select 1 from public.memories m where m.id = memory_id and private.can_admin_review_household(m.household_id)));
create policy items_read_global_admin on public.items for select to authenticated
  using (private.can_admin_review_household(household_id));
create policy item_people_read_global_admin on public.item_people for select to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and private.can_admin_review_household(i.household_id)));
create policy item_location_read_global_admin on public.item_location_history for select to authenticated
  using (private.can_admin_review_household(household_id));
create policy lists_read_global_admin on public.lists for select to authenticated
  using (exists (select 1 from public.households h where h.id = owner_household_id and private.can_admin_review_family(h.family_id)));
create policy list_items_read_global_admin on public.list_items for select to authenticated
  using (exists (select 1 from public.lists l join public.households h on h.id = l.owner_household_id
    where l.id = list_id and private.can_admin_review_family(h.family_id)));
create policy list_people_read_global_admin on public.list_people for select to authenticated
  using (exists (select 1 from public.lists l join public.households h on h.id = l.owner_household_id
    where l.id = list_id and private.can_admin_review_family(h.family_id)));
create policy list_access_read_global_admin on public.list_household_access for select to authenticated
  using (exists (select 1 from public.lists l join public.households h on h.id = l.owner_household_id
    where l.id = list_id and private.can_admin_review_family(h.family_id)));
create policy events_read_global_admin on public.events for select to authenticated
  using (private.can_admin_review_household(owner_household_id));
create policy event_people_read_global_admin on public.event_people for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and private.can_admin_review_household(e.owner_household_id)));
create policy event_access_read_global_admin on public.event_household_access for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and private.can_admin_review_household(e.owner_household_id)));
create policy activity_read_global_admin on public.activity_log for select to authenticated
  using (private.can_admin_review_household(household_id));

create or replace function public.create_gurtu_capture_request(
  p_request_id uuid,
  p_input_type text,
  p_original_transcript text default null
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_family uuid;
  v_household uuid;
  v_capture_id uuid;
  v_existing public.capture_requests%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or p_input_type is null or p_input_type not in ('text', 'voice')
    or (p_input_type = 'text' and length(trim(coalesce(p_original_transcript, ''))) = 0)
    or length(coalesce(p_original_transcript, '')) > 8000 then
    raise exception 'invalid capture request' using errcode = '22023';
  end if;
  select family_id, household_id into v_family, v_household from public.profiles where user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;

  insert into public.capture_requests(family_id, household_id, submitted_by_user_id, request_id, input_type,
    original_transcript, corrected_transcript, processing_status)
  values (v_family, v_household, v_user, p_request_id, p_input_type,
    nullif(p_original_transcript, ''), nullif(p_original_transcript, ''),
    case when p_input_type = 'voice' and p_original_transcript is null then 'transcribing' else 'received' end)
  on conflict (submitted_by_user_id, request_id) do nothing
  returning id into v_capture_id;

  if v_capture_id is null then
    select * into v_existing from public.capture_requests
      where submitted_by_user_id = v_user and request_id = p_request_id for update;
    if v_existing.family_id <> v_family or v_existing.household_id <> v_household or v_existing.input_type <> p_input_type then
      raise exception 'capture request does not match' using errcode = '23505';
    end if;
    if v_existing.original_transcript is not null and p_original_transcript is not null
      and v_existing.original_transcript <> p_original_transcript then
      raise exception 'capture transcript does not match' using errcode = '23505';
    end if;
    update public.capture_requests set
      original_transcript = coalesce(original_transcript, nullif(p_original_transcript, '')),
      corrected_transcript = coalesce(corrected_transcript, nullif(p_original_transcript, '')),
      processing_status = case when processing_status = 'transcribing' and p_original_transcript is not null then 'received' else processing_status end,
      updated_at = now()
      where id = v_existing.id returning id into v_capture_id;
  end if;
  return v_capture_id;
end
$$;

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
    or p_detected_intent is null or p_detected_intent not in ('save_memory','save_item_location','create_list','add_list_items','update_list_item','remove_list_item','create_event','update_event','clarify')
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
  if v_capture_id is null then raise exception 'capture request is not available' using errcode = '42501'; end if;
  return v_capture_id;
end
$$;

create or replace function public.fail_gurtu_capture(
  p_request_id uuid,
  p_processing_status text,
  p_error_code text,
  p_safe_error_description text
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or p_processing_status is null or p_processing_status not in ('transcription_failed','interpretation_failed','operation_failed')
    or length(coalesce(p_error_code, '')) not between 1 and 64
    or length(coalesce(p_safe_error_description, '')) not between 1 and 500 then
    raise exception 'invalid capture failure' using errcode = '22023';
  end if;
  update public.capture_requests set processing_status = p_processing_status,
    error_code = p_error_code, safe_error_description = p_safe_error_description, updated_at = now()
  where submitted_by_user_id = v_user and request_id = p_request_id and processing_status <> 'succeeded'
    and not exists (select 1 from public.operation_requests o where o.user_id = v_user and o.request_id = p_request_id and o.record_id is not null);
  return found;
end
$$;

create or replace function public.finish_gurtu_capture(
  p_request_id uuid,
  p_result_entity_type text,
  p_result_entity_id uuid
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or p_result_entity_type is null or p_result_entity_type not in ('memory','item','list','event') or p_result_entity_id is null then
    raise exception 'invalid capture result' using errcode = '22023';
  end if;
  update public.capture_requests set processing_status = 'succeeded', result_entity_type = p_result_entity_type,
    result_entity_id = p_result_entity_id, confirmed_at = coalesce(confirmed_at, now()), completed_at = now(),
    error_code = null, safe_error_description = null, updated_at = now()
  where submitted_by_user_id = v_user and request_id = p_request_id and processing_status <> 'succeeded';
  return found;
end
$$;

create or replace function public.confirm_gurtu_capture_operation(
  p_request_id uuid,
  p_corrected_transcript text,
  p_selected_person_ids uuid[]
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_family uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or length(trim(coalesce(p_corrected_transcript, ''))) not between 1 and 8000
    or cardinality(coalesce(p_selected_person_ids, '{}')) > 100 then
    raise exception 'invalid capture confirmation' using errcode = '22023';
  end if;
  select family_id into v_family from public.profiles where user_id = v_user;
  if exists (
    select 1 from unnest(coalesce(p_selected_person_ids, '{}')) x
    left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person selection is not in this family' using errcode = '42501'; end if;
  update public.capture_requests set corrected_transcript = p_corrected_transcript,
    selected_person_ids = coalesce(p_selected_person_ids, '{}'), processing_status = 'operation_pending',
    confirmed_at = coalesce(confirmed_at, now()), error_code = null, safe_error_description = null, updated_at = now()
  where submitted_by_user_id = v_user and request_id = p_request_id
    and processing_status in ('awaiting_confirmation', 'operation_pending', 'operation_failed');
  return found;
end
$$;

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
  if p_action is null or p_action not in ('family_activity_search','capture_viewed','transcript_viewed') then
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

create or replace function public.admin_retry_gurtu_capture(p_capture_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_admin uuid := auth.uid();
  v_admin_claims text := current_setting('request.jwt.claims', true);
  v_admin_sub text := current_setting('request.jwt.claim.sub', true);
  v_capture public.capture_requests%rowtype;
  v_entity_id uuid;
  v_record_type text;
  v_existing_record_id uuid;
  v_error_code text;
  v_transcript text;
begin
  if not private.is_global_admin_aal2() then raise exception 'administrator MFA is required' using errcode = '42501'; end if;
  select * into v_capture from public.capture_requests c
    where c.id = p_capture_request_id and c.family_id = private.current_family_id() for update;
  if not found then raise exception 'capture request is not available' using errcode = '42501'; end if;
  if v_capture.processing_status = 'succeeded' or v_capture.result_entity_id is not null then
    raise exception 'successful operations cannot be retried' using errcode = '22023';
  end if;
  if v_capture.processing_status not in ('operation_failed', 'operation_pending') or v_capture.extracted_payload is null then
    raise exception 'this operation is not eligible for retry' using errcode = '22023';
  end if;
  if v_capture.detected_intent is null or v_capture.detected_intent not in ('save_memory','save_item_location','create_list') then
    raise exception 'this operation is not eligible for automatic retry' using errcode = '22023';
  end if;
  v_record_type := case v_capture.detected_intent when 'save_memory' then 'memory' when 'save_item_location' then 'item' else 'list' end;
  select record_id into v_existing_record_id from public.operation_requests
    where user_id = v_capture.submitted_by_user_id and request_id = v_capture.request_id for update;
  if v_existing_record_id is not null then
    update public.capture_requests set processing_status = 'succeeded', result_entity_type = v_record_type,
      result_entity_id = v_existing_record_id, confirmed_at = coalesce(confirmed_at, now()), completed_at = now(),
      error_code = null, safe_error_description = null, updated_at = now() where id = v_capture.id;
    insert into public.admin_audit_log(family_id, admin_user_id, action, target_capture_request_id, target_record_type, target_record_id)
      values (v_capture.family_id, v_admin, 'retry_reconciled', v_capture.id, v_record_type, v_existing_record_id);
    return jsonb_build_object('ok', true, 'reconciled', true, 'result_entity_type', v_record_type, 'result_entity_id', v_existing_record_id);
  end if;

  v_transcript := coalesce(nullif(v_capture.corrected_transcript, ''), v_capture.original_transcript);
  begin
    perform set_config('request.jwt.claim.sub', v_capture.submitted_by_user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_capture.submitted_by_user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    case v_capture.detected_intent
      when 'save_memory' then
        select public.save_gurtu_memory(v_transcript, v_capture.detected_language,
          v_capture.extracted_payload->>'summary', v_capture.selected_person_ids, v_capture.request_id) into v_entity_id;
      when 'save_item_location' then
        select public.save_gurtu_item_location(v_transcript, v_capture.extracted_payload->>'item_name',
          v_capture.extracted_payload->>'location', v_capture.selected_person_ids, v_capture.request_id) into v_entity_id;
      when 'create_list' then
        select public.create_gurtu_list(v_capture.extracted_payload->>'title', v_capture.selected_person_ids,
          coalesce(array(select jsonb_array_elements_text(v_capture.extracted_payload->'items')), '{}'), v_capture.request_id) into v_entity_id;
    end case;
    perform set_config('request.jwt.claim.sub', coalesce(v_admin_sub, v_admin::text), true);
    perform set_config('request.jwt.claims', coalesce(v_admin_claims,
      jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text), true);
    update public.capture_requests set processing_status = 'succeeded', result_entity_type = v_record_type,
      result_entity_id = v_entity_id, confirmed_at = coalesce(confirmed_at, now()), completed_at = now(),
      error_code = null, safe_error_description = null, updated_at = now() where id = v_capture.id;
    insert into public.admin_audit_log(family_id, admin_user_id, action, target_capture_request_id, target_record_type, target_record_id)
      values (v_capture.family_id, v_admin, 'retry_succeeded', v_capture.id, v_record_type, v_entity_id);
    return jsonb_build_object('ok', true, 'result_entity_type', v_record_type, 'result_entity_id', v_entity_id);
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    perform set_config('request.jwt.claim.sub', coalesce(v_admin_sub, v_admin::text), true);
    perform set_config('request.jwt.claims', coalesce(v_admin_claims,
      jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text), true);
    update public.capture_requests set processing_status = 'operation_failed', error_code = v_error_code,
      safe_error_description = 'The saved action still could not be completed. Review the details and try again.',
      updated_at = now() where id = v_capture.id;
    insert into public.admin_audit_log(family_id, admin_user_id, action, target_capture_request_id, target_record_type, reason)
      values (v_capture.family_id, v_admin, 'retry_failed', v_capture.id, v_capture.detected_intent, 'Retry failed; see the safe status on the capture.');
    return jsonb_build_object('ok', false, 'message', 'The saved action still could not be completed.');
  end;
end
$$;

create or replace function public.admin_correct_capture_people(
  p_capture_request_id uuid,
  p_person_ids uuid[],
  p_reason text
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_admin uuid := auth.uid();
  v_family uuid := private.current_family_id();
  v_capture public.capture_requests%rowtype;
  v_owner_household uuid;
  v_shared_households uuid[];
begin
  if not private.is_global_admin_aal2() then raise exception 'administrator MFA is required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 or cardinality(coalesce(p_person_ids, '{}')) > 100 then
    raise exception 'provide a correction reason and valid people' using errcode = '22023';
  end if;
  select * into v_capture from public.capture_requests c
    where c.id = p_capture_request_id and c.family_id = v_family for update;
  if not found then raise exception 'capture request is not available' using errcode = '42501'; end if;
  if exists (
    select 1 from unnest(coalesce(p_person_ids, '{}')) x left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person selection is not in this family' using errcode = '42501'; end if;

  if v_capture.result_entity_id is not null then
    case v_capture.result_entity_type
      when 'memory' then
        delete from public.memory_people where memory_id = v_capture.result_entity_id;
        insert into public.memory_people(memory_id, person_id)
          select v_capture.result_entity_id, x from unnest(coalesce(p_person_ids, '{}')) x on conflict do nothing;
      when 'item' then
        delete from public.item_people where item_id = v_capture.result_entity_id;
        insert into public.item_people(item_id, person_id)
          select v_capture.result_entity_id, x from unnest(coalesce(p_person_ids, '{}')) x on conflict do nothing;
      when 'list' then
        select owner_household_id into v_owner_household from public.lists where id = v_capture.result_entity_id;
        delete from public.list_people where list_id = v_capture.result_entity_id;
        insert into public.list_people(list_id, person_id)
          select v_capture.result_entity_id, x from unnest(coalesce(p_person_ids, '{}')) x on conflict do nothing;
        select coalesce(array_agg(distinct home_household_id), '{}') into v_shared_households
          from public.people where id = any(coalesce(p_person_ids, '{}')) and home_household_id <> v_owner_household;
        delete from public.list_household_access where list_id = v_capture.result_entity_id
          and household_id <> v_owner_household and not (household_id = any(v_shared_households));
        insert into public.list_household_access(list_id, household_id, granted_by_user_id)
          select v_capture.result_entity_id, x, v_admin from unnest(v_shared_households) x on conflict do nothing;
      when 'event' then
        select owner_household_id into v_owner_household from public.events where id = v_capture.result_entity_id;
        delete from public.event_people where event_id = v_capture.result_entity_id;
        insert into public.event_people(event_id, person_id)
          select v_capture.result_entity_id, x from unnest(coalesce(p_person_ids, '{}')) x on conflict do nothing;
        select coalesce(array_agg(distinct home_household_id), '{}') into v_shared_households
          from public.people where id = any(coalesce(p_person_ids, '{}')) and home_household_id <> v_owner_household;
        delete from public.event_household_access where event_id = v_capture.result_entity_id
          and household_id <> v_owner_household and not (household_id = any(v_shared_households));
        insert into public.event_household_access(event_id, household_id, granted_by_user_id)
          select v_capture.result_entity_id, x, v_admin from unnest(v_shared_households) x on conflict do nothing;
      else raise exception 'this record has no correctable people association' using errcode = '22023';
    end case;
  end if;

  update public.capture_requests set selected_person_ids = coalesce(p_person_ids, '{}'), updated_at = now()
    where id = v_capture.id;
  insert into public.admin_audit_log(family_id, admin_user_id, action, target_capture_request_id,
    target_record_type, target_record_id, previous_value, new_value, reason)
  values (v_family, v_admin, 'people_corrected', v_capture.id, v_capture.result_entity_type,
    v_capture.result_entity_id, to_jsonb(v_capture.selected_person_ids), to_jsonb(coalesce(p_person_ids, '{}')), trim(p_reason));
  return true;
end
$$;

create or replace function public.admin_correct_capture_location(
  p_capture_request_id uuid,
  p_location text,
  p_reason text
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_admin uuid := auth.uid();
  v_family uuid := private.current_family_id();
  v_capture public.capture_requests%rowtype;
  v_previous_location text;
  v_history_id uuid;
  v_memory_id uuid;
  v_payload jsonb;
begin
  if not private.is_global_admin_aal2() then raise exception 'administrator MFA is required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_location, ''))) not between 1 and 500
    or length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'provide a corrected location and reason' using errcode = '22023';
  end if;
  select * into v_capture from public.capture_requests c
    where c.id = p_capture_request_id and c.family_id = v_family for update;
  if not found or v_capture.detected_intent <> 'save_item_location' then
    raise exception 'location capture is not available' using errcode = '42501';
  end if;
  v_previous_location := v_capture.extracted_payload->>'location';
  v_payload := jsonb_set(coalesce(v_capture.extracted_payload, '{}'::jsonb), '{location}', to_jsonb(trim(p_location)), true);

  if v_capture.result_entity_type = 'item' and v_capture.result_entity_id is not null then
    select l.id, l.source_memory_id, l.location_text into v_history_id, v_memory_id, v_previous_location
      from public.item_location_history l join public.memories m on m.id = l.source_memory_id
      where l.item_id = v_capture.result_entity_id and m.created_by_user_id = v_capture.submitted_by_user_id
        and m.request_id = v_capture.request_id
      order by l.created_at desc limit 1;
    if v_history_id is null then raise exception 'saved location could not be found' using errcode = 'P0002'; end if;
    insert into public.item_location_history(household_id, item_id, location_text, source_memory_id,
      recorded_by_user_id, corrected_by_admin_user_id, correction_of_history_id, correction_reason)
    values (v_capture.household_id, v_capture.result_entity_id, trim(p_location), v_memory_id,
      v_capture.submitted_by_user_id, v_admin, v_history_id, trim(p_reason));
  elsif v_capture.result_entity_id is not null then
    raise exception 'capture is not a correctable item location' using errcode = '22023';
  end if;

  update public.capture_requests set extracted_payload = v_payload, updated_at = now() where id = v_capture.id;
  insert into public.admin_audit_log(family_id, admin_user_id, action, target_capture_request_id,
    target_record_type, target_record_id, previous_value, new_value, reason)
  values (v_family, v_admin, 'location_corrected', v_capture.id, v_capture.result_entity_type,
    v_capture.result_entity_id, jsonb_build_object('location', v_previous_location),
    jsonb_build_object('location', trim(p_location)), trim(p_reason));
  return true;
end
$$;

revoke all on function public.create_gurtu_capture_request(uuid, text, text),
  public.update_gurtu_capture_interpretation(uuid, text, text, text, text, jsonb, uuid[], text),
  public.confirm_gurtu_capture_operation(uuid, text, uuid[]),
  public.fail_gurtu_capture(uuid, text, text, text), public.finish_gurtu_capture(uuid, text, uuid),
  public.log_gurtu_admin_action(text, uuid), public.admin_retry_gurtu_capture(uuid),
  public.admin_correct_capture_people(uuid, uuid[], text), public.admin_correct_capture_location(uuid, text, text)
  from public, anon;
grant execute on function public.create_gurtu_capture_request(uuid, text, text),
  public.update_gurtu_capture_interpretation(uuid, text, text, text, text, jsonb, uuid[], text),
  public.confirm_gurtu_capture_operation(uuid, text, uuid[]),
  public.fail_gurtu_capture(uuid, text, text, text), public.finish_gurtu_capture(uuid, text, uuid)
  to authenticated;
grant execute on function public.log_gurtu_admin_action(text, uuid), public.admin_retry_gurtu_capture(uuid),
  public.admin_correct_capture_people(uuid, uuid[], text), public.admin_correct_capture_location(uuid, text, text)
  to authenticated;
