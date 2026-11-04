-- Stage 3: household vocabulary.
--
-- * household_vocabulary maps an alias (a nickname, Telugu or Romanised spelling,
--   abbreviation, local word) to one canonical term, per household.
-- * Explicit teaching in chat ("Ramu and Ramesh are the same person") saves a
--   confirmed entry through the normal capture flow (intent teach_vocabulary).
-- * Background chat indexing may suggest variants it saw. Non-person terms are
--   confirmed after two different messages; person names stay suggestions until
--   someone states the link, so identities are never merged on spelling alone.
-- * A rejected pair ("Ramu is not Ramesh") is kept so it is never suggested again.

create table public.household_vocabulary (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  canonical_term text not null check (length(btrim(canonical_term)) between 1 and 80),
  alias text not null check (length(btrim(alias)) between 1 and 80),
  canonical_key text generated always as (lower(normalize(btrim(regexp_replace(canonical_term, '\s+', ' ', 'g')), NFKC))) stored,
  alias_key text generated always as (lower(normalize(btrim(regexp_replace(alias, '\s+', ' ', 'g')), NFKC))) stored,
  script text check (script is null or script in ('telugu', 'latin', 'mixed', 'other')),
  entity_type text not null check (entity_type in ('person', 'crop', 'product', 'equipment', 'supplier', 'location', 'expression', 'abbreviation')),
  person_id uuid references public.people(id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  source_message_ids uuid[] not null default '{}',
  conversation_id uuid references public.conversations(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (alias_key <> canonical_key)
);
create unique index household_vocabulary_pair_idx on public.household_vocabulary(household_id, alias_key, canonical_key);
create index household_vocabulary_lookup_idx on public.household_vocabulary(household_id, status, updated_at desc);
alter table public.household_vocabulary enable row level security;
revoke all on public.household_vocabulary from public, anon, authenticated;
grant select on public.household_vocabulary to authenticated;
create policy household_vocabulary_read_household on public.household_vocabulary for select to authenticated
  using (household_id = private.current_household_id());

-- Captures can now teach vocabulary.
alter table public.capture_requests drop constraint if exists capture_requests_detected_intent_check;
alter table public.capture_requests add constraint capture_requests_detected_intent_check
  check (detected_intent is null or detected_intent in (
    'save_memory', 'save_item_location', 'create_list', 'add_list_items',
    'update_list_item', 'remove_list_item', 'create_event', 'update_event',
    'delete_event', 'teach_vocabulary', 'clarify'
  ));
alter table public.capture_requests drop constraint if exists capture_requests_result_entity_type_check;
alter table public.capture_requests add constraint capture_requests_result_entity_type_check
  check (result_entity_type is null or result_entity_type in ('memory', 'item', 'list', 'event', 'vocabulary'));
alter table public.operation_requests drop constraint if exists operation_requests_record_type_check;
alter table public.operation_requests add constraint operation_requests_record_type_check
  check (record_type in ('memory', 'item', 'list', 'event', 'list_item_add', 'list_item_update', 'list_item_remove', 'event_update', 'event_delete', 'vocabulary'));

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
    or p_detected_intent is null or p_detected_intent not in ('save_memory','save_item_location','create_list','add_list_items','update_list_item','remove_list_item','create_event','update_event','delete_event','teach_vocabulary','clarify')
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
  if p_request_id is null or p_result_entity_type is null or p_result_entity_type not in ('memory','item','list','event','vocabulary') or p_result_entity_id is null then
    raise exception 'invalid capture result' using errcode = '22023';
  end if;
  update public.capture_requests set processing_status = 'succeeded', result_entity_type = p_result_entity_type,
    result_entity_id = p_result_entity_id, confirmed_at = coalesce(confirmed_at, now()), completed_at = now(),
    error_code = null, safe_error_description = null, updated_at = now()
  where submitted_by_user_id = v_user and request_id = p_request_id and processing_status <> 'succeeded';
  return found;
end
$$;

-- Explicit teaching: "same" confirms each alias for the canonical term and retires any
-- other confirmed meaning of that alias (the app asks before replacing one);
-- "not_same" records the pair as rejected. Idempotent per request ID.
create or replace function public.teach_gurtu_vocabulary(
  p_canonical_term text,
  p_aliases text[],
  p_entity_type text,
  p_relation text,
  p_person_id uuid,
  p_request_id uuid
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
  v_old_type text;
  v_old_id uuid;
  v_alias text;
  v_id uuid;
  v_first uuid;
  v_canonical_key text := lower(normalize(btrim(regexp_replace(coalesce(p_canonical_term, ''), '\s+', ' ', 'g')), NFKC));
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or length(btrim(coalesce(p_canonical_term, ''))) not between 1 and 80
    or cardinality(coalesce(p_aliases, '{}')) not between 1 and 10
    or p_entity_type is null or p_entity_type not in ('person', 'crop', 'product', 'equipment', 'supplier', 'location', 'expression', 'abbreviation')
    or p_relation is null or p_relation not in ('same', 'not_same') then
    raise exception 'invalid vocabulary' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_aliases) a where length(btrim(coalesce(a, ''))) not between 1 and 80) then
    raise exception 'invalid vocabulary' using errcode = '22023';
  end if;
  select p.family_id, p.household_id into v_family, v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
  if p_person_id is not null and not exists (select 1 from public.people where id = p_person_id and family_id = v_family and is_active) then
    raise exception 'person is not in this family' using errcode = '42501';
  end if;

  insert into public.operation_requests(user_id, request_id, record_type) values (v_user, p_request_id, 'vocabulary') on conflict do nothing;
  select record_type, record_id into v_old_type, v_old_id from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_old_type <> 'vocabulary' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_old_id is not null then return v_old_id; end if;

  foreach v_alias in array p_aliases loop
    continue when lower(normalize(btrim(regexp_replace(v_alias, '\s+', ' ', 'g')), NFKC)) = v_canonical_key;
    if p_relation = 'same' then
      update public.household_vocabulary set status = 'rejected', updated_at = now()
        where household_id = v_household and status = 'confirmed' and entity_type = p_entity_type
          and alias_key = lower(normalize(btrim(regexp_replace(v_alias, '\s+', ' ', 'g')), NFKC)) and canonical_key <> v_canonical_key;
    end if;
    insert into public.household_vocabulary(household_id, canonical_term, alias, script, entity_type, person_id, status,
      created_by_user_id, confirmed_by_user_id)
    values (v_household, btrim(p_canonical_term), btrim(v_alias),
      case when v_alias ~ '[ఀ-౿]' and v_alias ~ '[A-Za-z]' then 'mixed' when v_alias ~ '[ఀ-౿]' then 'telugu' when v_alias ~ '[A-Za-z]' then 'latin' else 'other' end,
      p_entity_type, p_person_id, case when p_relation = 'same' then 'confirmed' else 'rejected' end, v_user, v_user)
    on conflict (household_id, alias_key, canonical_key) do update set
      status = excluded.status, entity_type = excluded.entity_type, person_id = coalesce(excluded.person_id, household_vocabulary.person_id),
      confirmed_by_user_id = v_user, updated_at = now()
    returning id into v_id;
    v_first := coalesce(v_first, v_id);
  end loop;
  if v_first is null then raise exception 'invalid vocabulary' using errcode = '22023'; end if;
  update public.operation_requests set record_id = v_first where user_id = v_user and request_id = p_request_id;
  return v_first;
end
$$;

-- A variant seen in chat. Never overrides a rejected pair or a confirmed meaning.
create or replace function private.suggest_vocabulary(
  p_household_id uuid,
  p_user_id uuid,
  p_canonical_term text,
  p_alias text,
  p_entity_type text,
  p_script text,
  p_source_message_id uuid,
  p_conversation_id uuid
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_alias_key text := lower(normalize(btrim(regexp_replace(coalesce(p_alias, ''), '\s+', ' ', 'g')), NFKC));
  v_canonical_key text := lower(normalize(btrim(regexp_replace(coalesce(p_canonical_term, ''), '\s+', ' ', 'g')), NFKC));
begin
  if length(v_alias_key) not between 1 and 80 or length(v_canonical_key) not between 1 and 80 or v_alias_key = v_canonical_key
    or coalesce(p_entity_type, '') not in ('person', 'crop', 'product', 'equipment', 'supplier', 'location', 'expression', 'abbreviation') then
    return;
  end if;
  -- An alias that already has a confirmed meaning is not re-suggested for another one.
  if exists (select 1 from public.household_vocabulary where household_id = p_household_id and alias_key = v_alias_key and status = 'confirmed' and canonical_key <> v_canonical_key) then
    return;
  end if;
  insert into public.household_vocabulary(household_id, canonical_term, alias, script, entity_type, status, source_message_ids, conversation_id, created_by_user_id)
  values (p_household_id, btrim(p_canonical_term), btrim(p_alias), p_script, p_entity_type, 'suggested',
    case when p_source_message_id is null then '{}' else array[p_source_message_id] end, p_conversation_id, p_user_id)
  on conflict (household_id, alias_key, canonical_key) do update set
    source_message_ids = case
      when p_source_message_id is null or p_source_message_id = any(household_vocabulary.source_message_ids) then household_vocabulary.source_message_ids
      else (household_vocabulary.source_message_ids || p_source_message_id)[greatest(1, cardinality(household_vocabulary.source_message_ids) - 18):] end,
    status = case
      when household_vocabulary.status <> 'suggested' then household_vocabulary.status
      when household_vocabulary.entity_type <> 'person' and p_source_message_id is not null
        and not (p_source_message_id = any(household_vocabulary.source_message_ids))
        and cardinality(household_vocabulary.source_message_ids) >= 1 then 'confirmed'
      else 'suggested' end,
    updated_at = now();
end
$$;

drop function public.apply_gurtu_conversation_index(uuid, integer, text, uuid, jsonb, jsonb, text);
create or replace function public.apply_gurtu_conversation_index(
  p_job_id uuid,
  p_expected_version integer,
  p_summary text,
  p_through_message_id uuid,
  p_memories jsonb default '[]'::jsonb,
  p_updates jsonb default '[]'::jsonb,
  p_embedding_model text default null,
  p_vocabulary jsonb default '[]'::jsonb
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_job public.memory_index_jobs%rowtype;
  v_family uuid;
  v_speaker text;
  v_through_at timestamptz;
  v_target_at timestamptz;
  v_item jsonb;
  v_people uuid[];
  v_sources uuid[];
  v_requested_people uuid[];
  v_requested_sources uuid[];
  v_inserted uuid[] := '{}';
  v_new_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_job from public.memory_index_jobs where id = p_job_id and user_id = v_user and job_type = 'conversation_turn' and status = 'running' for update;
  if v_job.id is null then raise exception 'index job is not available' using errcode = '42501'; end if;
  if length(trim(coalesce(p_summary, ''))) not between 1 and 6000
    or jsonb_typeof(coalesce(p_memories, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_memories, '[]'::jsonb)) > 12
    or jsonb_typeof(coalesce(p_updates, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_updates, '[]'::jsonb)) > 12
    or jsonb_typeof(coalesce(p_vocabulary, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_vocabulary, '[]'::jsonb)) > 8 then
    raise exception 'invalid conversation index' using errcode = '22023';
  end if;
  select m.created_at into v_through_at from public.talk_messages m
    where m.id = p_through_message_id and m.conversation_id = v_job.conversation_id and m.user_id = v_user;
  if v_through_at is null then raise exception 'summary cursor is not in this conversation' using errcode = '42501'; end if;
  select p.family_id, p.display_name into v_family, v_speaker from public.profiles p where p.user_id = v_user;

  update public.conversations set summary_en = trim(p_summary), summary_version = summary_version + 1,
    summary_through_message_id = p_through_message_id, summary_through_at = v_through_at, summary_updated_at = now()
  where id = v_job.conversation_id and user_id = v_user and summary_version = p_expected_version
    and (summary_through_at is null or summary_through_at <= v_through_at);
  if not found then
    update public.memory_index_jobs set status = 'pending', locked_until = null, updated_at = now() where id = v_job.id;
    return false;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_memories, '[]'::jsonb)) loop
    if length(trim(coalesce(v_item->>'english_text', ''))) not between 1 and 1000
      or coalesce(v_item->>'memory_type', '') not in ('fact', 'plan', 'decision', 'completed_action', 'preference', 'other')
      or coalesce(v_item->>'status', '') not in ('current', 'completed', 'uncertain') then
      raise exception 'invalid family memory' using errcode = '22023';
    end if;
    v_requested_people := array(select jsonb_array_elements_text(coalesce(v_item->'people_ids', '[]'::jsonb)))::uuid[];
    v_requested_sources := array(select jsonb_array_elements_text(coalesce(v_item->'source_message_ids', '[]'::jsonb)))::uuid[];
    -- Keep only people in this family and messages from this conversation.
    select coalesce(array_agg(p.id), '{}') into v_people from public.people p
      where p.family_id = v_family and p.is_active and p.id = any(v_requested_people);
    select coalesce(array_agg(m.id), '{}') into v_sources from public.talk_messages m
      where m.conversation_id = v_job.conversation_id and m.id = any(v_requested_sources);
    insert into public.family_memories(household_id, source_kind, conversation_id, source_message_ids, original_language,
      english_text, memory_type, status, people_ids, occurred_on_start, occurred_on_end, date_precision, speaker_name,
      created_by_user_id, embedding, embedding_model)
    values (v_job.household_id, 'conversation', v_job.conversation_id, v_sources,
      nullif(v_item->>'original_language', ''), trim(v_item->>'english_text'), v_item->>'memory_type', v_item->>'status', v_people,
      nullif(v_item->>'occurred_on_start', '')::date, nullif(v_item->>'occurred_on_end', '')::date, nullif(v_item->>'date_precision', ''),
      v_speaker, v_user, nullif(v_item->>'embedding', '')::extensions.vector(1536), p_embedding_model)
    returning id into v_new_id;
    v_inserted := v_inserted || v_new_id;
  end loop;

  -- Newer information marks an older household fact superseded or completed; history is kept.
  for v_item in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    if coalesce(v_item->>'status', '') not in ('superseded', 'completed') then raise exception 'invalid memory update' using errcode = '22023'; end if;
    update public.family_memories f set status = v_item->>'status', updated_at = now(),
      superseded_by = case
        when (v_item->>'replaced_by_index') ~ '^[0-9]+$' and (v_item->>'replaced_by_index')::int between 0 and coalesce(array_length(v_inserted, 1), 0) - 1
        then v_inserted[(v_item->>'replaced_by_index')::int + 1] else f.superseded_by end
    where f.id = (v_item->>'memory_id')::uuid and f.household_id = v_job.household_id and f.status in ('current', 'uncertain');
  end loop;

  -- Spelling variants the family actually used. Person names are only suggested;
  -- other terms are confirmed once seen in two different messages.
  for v_item in select * from jsonb_array_elements(coalesce(p_vocabulary, '[]'::jsonb)) loop
    perform private.suggest_vocabulary(v_job.household_id, v_user, v_item->>'canonical_term', v_item->>'alias',
      v_item->>'entity_type', nullif(v_item->>'script', ''), nullif(v_item->>'source_message_id', '')::uuid, v_job.conversation_id);
  end loop;

  select m.created_at into v_target_at from public.talk_messages m where m.id = v_job.target_message_id;
  update public.memory_index_jobs set
    status = case when v_target_at is null or v_target_at <= v_through_at then 'done' else 'pending' end,
    last_error = null, locked_until = null, updated_at = now()
  where id = v_job.id;
  return true;
end
$$;

revoke all on function public.teach_gurtu_vocabulary(text, text[], text, text, uuid, uuid),
  public.apply_gurtu_conversation_index(uuid, integer, text, uuid, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function public.teach_gurtu_vocabulary(text, text[], text, text, uuid, uuid),
  public.apply_gurtu_conversation_index(uuid, integer, text, uuid, jsonb, jsonb, text, jsonb) to authenticated;
revoke all on function private.suggest_vocabulary(uuid, uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
