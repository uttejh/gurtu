-- Stages 4-5: Farm Kharchu ledger and cross-module coordination.
--
-- * ledger_entries: exact integer paise, a small fixed financial nature, and a
--   status (actual, planned, estimate). Only actual, non-voided rows count.
-- * Cash handovers: the handover is one money-out row; ledger_allocations say
--   what it was used for (they are not extra cash movements); money returned is
--   a cash_returned row. allocations + returns can never exceed the handover.
-- * Tasks are list items with an optional due date; events and ledger rows can
--   link to a task. A dated task is shown in the calendar without a copy.
-- * apply_gurtu_family_plan applies every change one message asks for in one
--   transaction, once per request ID.
-- * get_gurtu_ledger_report computes all totals in SQL.

-- Tasks: due dates and completion time on list items; events can link to a task.
alter table public.list_items
  add column due_on date,
  add column completed_at timestamptz;
create index list_items_due_idx on public.list_items(due_on) where due_on is not null;

create or replace function private.stamp_list_item_completion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.is_completed and not coalesce(old.is_completed, false) then new.completed_at := coalesce(new.completed_at, now());
  elsif not new.is_completed then new.completed_at := null;
  end if;
  return new;
end
$$;
create trigger list_items_stamp_completion before insert or update of is_completed on public.list_items
  for each row execute function private.stamp_list_item_completion();
update public.list_items set completed_at = updated_at where is_completed and completed_at is null;

alter table public.events add column related_list_item_id uuid references public.list_items(id) on delete set null;

create table public.ledger_parties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text generated always as (lower(normalize(btrim(regexp_replace(name, '\s+', ' ', 'g')), NFKC))) stored,
  kind text not null default 'other' check (kind in ('worker', 'driver', 'mechanic', 'supplier', 'bank', 'landlord', 'buyer', 'family', 'other')),
  person_id uuid references public.people(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name_key)
);

create table public.ledger_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text generated always as (lower(normalize(btrim(regexp_replace(name, '\s+', ' ', 'g')), NFKC))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name_key)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  nature text not null check (nature in ('income', 'operating_expense', 'personal_payment', 'loan_received',
    'loan_principal_repayment', 'interest_payment', 'cash_handover', 'cash_returned', 'transfer_adjustment')),
  direction text not null check (direction in ('in', 'out')),
  status text not null default 'actual' check (status in ('actual', 'planned', 'estimate')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  currency text not null default 'INR' check (currency = 'INR'),
  description_en text not null check (length(btrim(description_en)) between 1 and 300),
  original_text text check (original_text is null or length(original_text) <= 8000),
  occurred_on_start date,
  occurred_on_end date,
  date_precision text not null default 'exact' check (date_precision in ('exact', 'approximate', 'unknown')),
  date_expression text check (date_expression is null or length(date_expression) <= 80),
  due_on date,
  party_id uuid references public.ledger_parties(id) on delete set null,
  category_id uuid references public.ledger_categories(id) on delete set null,
  quantity numeric(14, 3) check (quantity is null or quantity > 0),
  unit text check (unit is null or length(btrim(unit)) between 1 and 30),
  related_list_item_id uuid references public.list_items(id) on delete set null,
  related_event_id uuid references public.events(id) on delete set null,
  handover_entry_id uuid references public.ledger_entries(id) on delete restrict,
  fulfils_entry_id uuid references public.ledger_entries(id) on delete restrict,
  source_message_id uuid references public.talk_messages(id) on delete set null,
  request_id uuid not null,
  op_index integer not null check (op_index >= 0),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (void_reason is null or length(void_reason) <= 300),
  unique (household_id, request_id, op_index),
  check (
    (nature in ('income', 'loan_received', 'cash_returned') and direction = 'in')
    or (nature in ('operating_expense', 'personal_payment', 'loan_principal_repayment', 'interest_payment', 'cash_handover') and direction = 'out')
    or nature = 'transfer_adjustment'
  ),
  check (nature <> 'cash_returned' or (handover_entry_id is not null and status = 'actual')),
  check (nature = 'cash_returned' or handover_entry_id is null),
  check (occurred_on_end is null or occurred_on_start is null or occurred_on_end >= occurred_on_start),
  check (date_precision <> 'exact' or occurred_on_end is null or occurred_on_end = occurred_on_start)
);
create index ledger_entries_household_date_idx on public.ledger_entries(household_id, occurred_on_start desc);
create index ledger_entries_party_idx on public.ledger_entries(party_id);
create index ledger_entries_handover_idx on public.ledger_entries(handover_entry_id) where handover_entry_id is not null;
create index ledger_entries_search_idx on public.ledger_entries using gin (to_tsvector('simple', description_en || ' ' || coalesce(original_text, '')));

create table public.ledger_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  handover_entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  description_en text not null check (length(btrim(description_en)) between 1 and 300),
  category_id uuid references public.ledger_categories(id) on delete set null,
  kind text not null check (kind in ('farm_purchase', 'household_purchase', 'personal', 'wage_advance_applied', 'other')),
  quantity numeric(14, 3) check (quantity is null or quantity > 0),
  unit text check (unit is null or length(btrim(unit)) between 1 and 30),
  request_id uuid not null,
  op_index integer not null check (op_index >= 0),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  unique (household_id, request_id, op_index)
);
create index ledger_allocations_handover_idx on public.ledger_allocations(handover_entry_id);

create table public.ledger_entry_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  change_kind text not null check (change_kind in ('corrected', 'voided')),
  previous_value jsonb not null,
  new_value jsonb not null,
  reason text check (reason is null or length(reason) <= 300),
  source_message_id uuid references public.talk_messages(id) on delete set null,
  changed_by_user_id uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);
create index ledger_entry_history_entry_idx on public.ledger_entry_history(entry_id, changed_at);

create table public.family_plan_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

-- Household-only reads; all writes go through apply_gurtu_family_plan.
alter table public.ledger_parties enable row level security;
alter table public.ledger_categories enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_allocations enable row level security;
alter table public.ledger_entry_history enable row level security;
alter table public.family_plan_runs enable row level security;
revoke all on public.ledger_parties, public.ledger_categories, public.ledger_entries, public.ledger_allocations,
  public.ledger_entry_history, public.family_plan_runs from public, anon, authenticated;
grant select on public.ledger_parties, public.ledger_categories, public.ledger_entries, public.ledger_allocations,
  public.ledger_entry_history to authenticated;
create policy ledger_parties_read_household on public.ledger_parties for select to authenticated using (household_id = private.current_household_id());
create policy ledger_categories_read_household on public.ledger_categories for select to authenticated using (household_id = private.current_household_id());
create policy ledger_entries_read_household on public.ledger_entries for select to authenticated using (household_id = private.current_household_id());
create policy ledger_allocations_read_household on public.ledger_allocations for select to authenticated using (household_id = private.current_household_id());
create policy ledger_history_read_household on public.ledger_entry_history for select to authenticated using (household_id = private.current_household_id());

-- Settlement invariant: allocations + returned cash never exceed the handover.
create or replace function private.check_handover_balance(p_handover uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_handover public.ledger_entries%rowtype;
  v_used bigint;
begin
  if p_handover is null then return; end if;
  select * into v_handover from public.ledger_entries where id = p_handover;
  if v_handover.id is null or v_handover.nature <> 'cash_handover' then
    raise exception 'settlement target is not a cash handover' using errcode = '22023';
  end if;
  select coalesce((select sum(amount_paise) from public.ledger_allocations where handover_entry_id = p_handover and voided_at is null), 0)
       + coalesce((select sum(amount_paise) from public.ledger_entries where handover_entry_id = p_handover and voided_at is null), 0)
    into v_used;
  -- Money can only be accounted for against cash that was actually handed over.
  if v_handover.status <> 'actual' and v_used > 0 then
    raise exception 'settlement target is not a cash handover' using errcode = '22023';
  end if;
  if v_handover.voided_at is null and v_used > v_handover.amount_paise then
    raise exception 'settlement exceeds handover' using errcode = '22023', detail = format('used=%s handover=%s', v_used, v_handover.amount_paise);
  end if;
  if v_handover.voided_at is not null and v_used > 0 then
    raise exception 'entry has dependent records' using errcode = '23503';
  end if;
end
$$;

create or replace function private.ledger_balance_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'ledger_allocations' then
    perform private.check_handover_balance(new.handover_entry_id);
  else
    if new.handover_entry_id is not null then perform private.check_handover_balance(new.handover_entry_id); end if;
    if new.nature = 'cash_handover' then perform private.check_handover_balance(new.id); end if;
  end if;
  return new;
end
$$;
create constraint trigger ledger_allocations_balance after insert or update on public.ledger_allocations
  deferrable initially deferred for each row execute function private.ledger_balance_trigger();
create constraint trigger ledger_entries_balance after insert or update on public.ledger_entries
  deferrable initially deferred for each row execute function private.ledger_balance_trigger();

-- Captures and history know about plans and ledger records.
alter table public.capture_requests drop constraint if exists capture_requests_detected_intent_check;
alter table public.capture_requests add constraint capture_requests_detected_intent_check
  check (detected_intent is null or detected_intent in (
    'save_memory', 'save_item_location', 'create_list', 'add_list_items',
    'update_list_item', 'remove_list_item', 'create_event', 'update_event',
    'delete_event', 'teach_vocabulary', 'family_plan', 'clarify'
  ));
alter table public.capture_requests drop constraint if exists capture_requests_result_entity_type_check;
alter table public.capture_requests add constraint capture_requests_result_entity_type_check
  check (result_entity_type is null or result_entity_type in ('memory', 'item', 'list', 'event', 'vocabulary', 'ledger'));
alter table public.talk_messages drop constraint if exists talk_messages_result_type_check;
alter table public.talk_messages add constraint talk_messages_result_type_check
  check (result_type is null or result_type in ('memory', 'list', 'event', 'answer', 'ledger'));
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in (
    'memory_saved', 'item_location_changed', 'list_created', 'list_item_added',
    'list_item_completed', 'list_item_uncompleted', 'list_item_removed',
    'event_created', 'event_updated', 'event_deleted',
    'ledger_recorded', 'ledger_corrected', 'ledger_voided'
  ));
alter table public.activity_log drop constraint if exists activity_log_record_type_check;
alter table public.activity_log add constraint activity_log_record_type_check
  check (record_type in ('memory', 'item', 'list', 'list_item', 'event', 'ledger'));

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
    or p_detected_intent is null or p_detected_intent not in ('save_memory','save_item_location','create_list','add_list_items','update_list_item','remove_list_item','create_event','update_event','delete_event','teach_vocabulary','family_plan','clarify')
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
    and not exists (select 1 from public.family_plan_runs r where r.user_id = v_user and r.request_id = p_request_id and r.result is not null)
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
  if p_request_id is null or p_result_entity_type is null or p_result_entity_type not in ('memory','item','list','event','vocabulary','ledger') or p_result_entity_id is null then
    raise exception 'invalid capture result' using errcode = '22023';
  end if;
  update public.capture_requests set processing_status = 'succeeded', result_entity_type = p_result_entity_type,
    result_entity_id = p_result_entity_id, confirmed_at = coalesce(confirmed_at, now()), completed_at = now(),
    error_code = null, safe_error_description = null, updated_at = now()
  where submitted_by_user_id = v_user and request_id = p_request_id and processing_status <> 'succeeded';
  return found;
end
$$;

-- Chat replies can link to Farm Kharchu.
create or replace function public.record_gurtu_reply(
  p_reply_to_message_id uuid,
  p_content text,
  p_result_type text default null,
  p_result_id uuid default null,
  p_sources jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_conversation uuid;
  v_reply uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_reply_to_message_id is null or length(trim(coalesce(p_content, ''))) not between 1 and 8000
    or (p_result_type is not null and p_result_type not in ('memory', 'list', 'event', 'answer', 'ledger'))
    or p_sources is null or jsonb_typeof(p_sources) <> 'array'
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid reply' using errcode = '22023';
  end if;
  select m.conversation_id into v_conversation from public.talk_messages m
    where m.id = p_reply_to_message_id and m.user_id = v_user for update;
  if v_conversation is null then raise exception 'message is not available' using errcode = '42501'; end if;
  insert into public.talk_messages(user_id, conversation_id, role, content, result_type, result_id, sources, reply_to_message_id, metadata)
  values (v_user, v_conversation, 'assistant', p_content, p_result_type, p_result_id, p_sources, p_reply_to_message_id, p_metadata)
  on conflict (reply_to_message_id) where reply_to_message_id is not null do nothing
  returning id into v_reply;
  if v_reply is null then
    select m.id into v_reply from public.talk_messages m where m.reply_to_message_id = p_reply_to_message_id;
  end if;
  return v_reply;
end
$$;

-- Party and category lookup-or-create inside the caller's household.
create or replace function private.ledger_party(p_household uuid, p_user uuid, p_name text, p_kind text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_key text := lower(normalize(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), NFKC));
  v_canonical text;
  v_id uuid;
begin
  if length(v_key) = 0 then return null; end if;
  -- A confirmed person alias ("Ramu" = "Ramesh") resolves to the canonical name.
  select v.canonical_term into v_canonical from public.household_vocabulary v
    where v.household_id = p_household and v.status = 'confirmed' and v.entity_type in ('person', 'supplier') and v.alias_key = v_key
    order by v.updated_at desc limit 1;
  if v_canonical is not null then p_name := v_canonical; end if;
  insert into public.ledger_parties(household_id, name, kind, created_by_user_id)
    values (p_household, btrim(p_name), coalesce(nullif(p_kind, ''), 'other'), p_user)
    on conflict (household_id, name_key) do update set updated_at = now(),
      kind = case when ledger_parties.kind = 'other' then excluded.kind else ledger_parties.kind end
    returning id into v_id;
  return v_id;
end
$$;

create or replace function private.ledger_category(p_household uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_id uuid;
begin
  if length(btrim(coalesce(p_name, ''))) = 0 then return null; end if;
  insert into public.ledger_categories(household_id, name) values (p_household, btrim(p_name))
    on conflict (household_id, name_key) do update set updated_at = now()
    returning id into v_id;
  return v_id;
end
$$;

create or replace function private.plan_uuid(p_request uuid, p_index integer)
returns uuid
language sql immutable
set search_path = pg_catalog
as $$ select md5(p_request::text || ':' || p_index::text)::uuid $$;

-- Applies one message's operations in one transaction. Retrying the same
-- request returns the first result. Operation IDs from the app are re-checked here.
create or replace function public.apply_gurtu_family_plan(
  p_request_id uuid,
  p_source_message_id uuid,
  p_original_text text,
  p_operations jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_family uuid;
  v_household uuid;
  v_existing jsonb;
  v_op jsonb;
  v_index integer;
  v_refs jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_list uuid;
  v_task uuid;
  v_event uuid;
  v_handover uuid;
  v_fulfils uuid;
  v_party uuid;
  v_category uuid;
  v_entry public.ledger_entries%rowtype;
  v_new jsonb;
  v_position integer;
  v_nature text;
  v_source uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or p_operations is null or jsonb_typeof(p_operations) <> 'array'
    or jsonb_array_length(p_operations) not between 1 and 20 or length(coalesce(p_original_text, '')) > 8000 then
    raise exception 'invalid plan' using errcode = '22023';
  end if;
  select p.family_id, p.household_id into v_family, v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
  select m.id into v_source from public.talk_messages m where m.id = p_source_message_id and m.user_id = v_user;

  insert into public.family_plan_runs(user_id, request_id, household_id) values (v_user, p_request_id, v_household) on conflict do nothing;
  select result into v_existing from public.family_plan_runs where user_id = v_user and request_id = p_request_id for update;
  if v_existing is not null then return v_existing; end if;

  for v_op, v_index in select value, (ordinality - 1)::integer from jsonb_array_elements(p_operations) with ordinality loop
    v_id := null;
    case v_op->>'op'
    when 'create_task' then
      if length(btrim(coalesce(v_op->>'item_text', ''))) not between 1 and 300 then raise exception 'invalid task' using errcode = '22023'; end if;
      select l.id into v_list from public.lists l
        where lower(btrim(l.title)) = lower(btrim(coalesce(nullif(v_op->>'list_title', ''), 'Tasks')))
          and (l.owner_household_id = v_household or exists (select 1 from public.list_household_access a where a.list_id = l.id and a.household_id = v_household))
        order by (l.owner_household_id = v_household) desc, l.created_at limit 1;
      if v_list is null then
        insert into public.lists(owner_household_id, title, created_by_user_id, request_id)
          values (v_household, btrim(coalesce(nullif(v_op->>'list_title', ''), 'Tasks')), v_user, private.plan_uuid(p_request_id, 1000 + v_index))
          returning id into v_list;
        insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values (v_household, v_user, 'list_created', 'list', v_list);
      end if;
      select coalesce(max(position), 0) + 1 into v_position from public.list_items where list_id = v_list;
      insert into public.list_items(list_id, item_text, created_by_user_id, request_id, position, due_on)
        values (v_list, btrim(v_op->>'item_text'), v_user, private.plan_uuid(p_request_id, v_index), v_position, nullif(v_op->>'due_on', '')::date)
        returning id into v_id;
      insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values (v_household, v_user, 'list_item_added', 'list_item', v_id);
    when 'complete_task' then
      select i.id into v_id from public.list_items i where i.id = (v_op->>'list_item_id')::uuid
        and exists (select 1 from public.lists l where l.id = i.list_id and (l.owner_household_id = v_household
          or exists (select 1 from public.list_household_access a where a.list_id = l.id and a.household_id = v_household)))
        for update;
      if v_id is null then raise exception 'task is not available' using errcode = '42501'; end if;
      update public.list_items set is_completed = true, updated_at = now() where id = v_id;
      insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values (v_household, v_user, 'list_item_completed', 'list_item', v_id);
    when 'create_event' then
      v_task := coalesce((v_refs->>(v_op->>'task_ref'))::uuid, nullif(v_op->>'list_item_id', '')::uuid);
      v_id := public.create_gurtu_event(v_op->>'title', null, (v_op->>'starts_at')::timestamptz, (v_op->>'ends_at')::timestamptz,
        v_op->>'timezone', coalesce((v_op->>'is_all_day')::boolean, false), '{}'::uuid[], private.plan_uuid(p_request_id, v_index));
      if v_task is not null then
        if not exists (select 1 from public.list_items i join public.lists l on l.id = i.list_id where i.id = v_task
          and (l.owner_household_id = v_household or exists (select 1 from public.list_household_access a where a.list_id = l.id and a.household_id = v_household))) then
          raise exception 'task is not available' using errcode = '42501';
        end if;
        update public.events set related_list_item_id = v_task where id = v_id;
      end if;
    when 'ledger_entry' then
      v_nature := v_op->>'nature';
      v_task := coalesce((v_refs->>(v_op->>'task_ref'))::uuid, nullif(v_op->>'list_item_id', '')::uuid);
      v_event := coalesce((v_refs->>(v_op->>'event_ref'))::uuid, nullif(v_op->>'event_id', '')::uuid);
      v_handover := coalesce((v_refs->>(v_op->>'handover_ref'))::uuid, nullif(v_op->>'handover_entry_id', '')::uuid);
      v_fulfils := nullif(v_op->>'fulfils_entry_id', '')::uuid;
      if v_task is not null and not exists (select 1 from public.list_items i join public.lists l on l.id = i.list_id where i.id = v_task
        and (l.owner_household_id = v_household or exists (select 1 from public.list_household_access a where a.list_id = l.id and a.household_id = v_household))) then
        raise exception 'task is not available' using errcode = '42501';
      end if;
      if v_event is not null and not exists (select 1 from public.events e where e.id = v_event and e.owner_household_id = v_household) then
        raise exception 'event is not available' using errcode = '42501';
      end if;
      if v_handover is not null and not exists (select 1 from public.ledger_entries e where e.id = v_handover and e.household_id = v_household and e.voided_at is null) then
        raise exception 'handover is not available' using errcode = '42501';
      end if;
      if v_fulfils is not null and not exists (select 1 from public.ledger_entries e where e.id = v_fulfils and e.household_id = v_household
        and e.status = 'planned' and e.voided_at is null
        and not exists (select 1 from public.ledger_entries f where f.fulfils_entry_id = e.id and f.voided_at is null)) then
        raise exception 'planned payment is not available' using errcode = '42501';
      end if;
      v_party := private.ledger_party(v_household, v_user, v_op->>'party_name', v_op->>'party_kind');
      v_category := private.ledger_category(v_household, v_op->>'category_name');
      insert into public.ledger_entries(household_id, nature, direction, status, amount_paise, description_en, original_text,
        occurred_on_start, occurred_on_end, date_precision, date_expression, due_on, party_id, category_id, quantity, unit,
        related_list_item_id, related_event_id, handover_entry_id, fulfils_entry_id, source_message_id, request_id, op_index, created_by_user_id)
      values (v_household, v_nature,
        case when v_nature in ('income', 'loan_received', 'cash_returned') then 'in'
             when v_nature = 'transfer_adjustment' then coalesce(nullif(v_op->>'direction', ''), 'out') else 'out' end,
        coalesce(nullif(v_op->>'status', ''), 'actual'), (v_op->>'amount_paise')::bigint, btrim(v_op->>'description_en'), p_original_text,
        nullif(v_op->>'occurred_on_start', '')::date, nullif(v_op->>'occurred_on_end', '')::date,
        coalesce(nullif(v_op->>'date_precision', ''), 'exact'), nullif(v_op->>'date_expression', ''), nullif(v_op->>'due_on', '')::date,
        v_party, v_category, nullif(v_op->>'quantity', '')::numeric, nullif(v_op->>'unit', ''),
        v_task, v_event, v_handover, v_fulfils, v_source, p_request_id, v_index, v_user)
      returning id into v_id;
      insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values (v_household, v_user, 'ledger_recorded', 'ledger', v_id);
    when 'allocation' then
      v_handover := coalesce((v_refs->>(v_op->>'handover_ref'))::uuid, nullif(v_op->>'handover_entry_id', '')::uuid);
      if v_handover is null or not exists (select 1 from public.ledger_entries e where e.id = v_handover and e.household_id = v_household and e.voided_at is null) then
        raise exception 'handover is not available' using errcode = '42501';
      end if;
      insert into public.ledger_allocations(household_id, handover_entry_id, amount_paise, description_en, category_id, kind, quantity, unit, request_id, op_index, created_by_user_id)
      values (v_household, v_handover, (v_op->>'amount_paise')::bigint, btrim(v_op->>'description_en'),
        private.ledger_category(v_household, v_op->>'category_name'), coalesce(nullif(v_op->>'kind', ''), 'other'),
        nullif(v_op->>'quantity', '')::numeric, nullif(v_op->>'unit', ''), p_request_id, v_index, v_user)
      returning id into v_id;
    when 'correct_entry', 'void_entry' then
      select * into v_entry from public.ledger_entries where id = (v_op->>'entry_id')::uuid and household_id = v_household and voided_at is null for update;
      if v_entry.id is null then raise exception 'entry is not available' using errcode = '42501'; end if;
      if v_op->>'op' = 'void_entry' then
        if exists (select 1 from public.ledger_allocations a where a.handover_entry_id = v_entry.id and a.voided_at is null)
          or exists (select 1 from public.ledger_entries e where (e.handover_entry_id = v_entry.id or e.fulfils_entry_id = v_entry.id) and e.voided_at is null) then
          raise exception 'entry has dependent records' using errcode = '23503';
        end if;
        update public.ledger_entries set voided_at = now(), void_reason = nullif(v_op->>'reason', ''), updated_at = now() where id = v_entry.id;
        insert into public.ledger_entry_history(household_id, entry_id, change_kind, previous_value, new_value, reason, source_message_id, changed_by_user_id)
          values (v_household, v_entry.id, 'voided', to_jsonb(v_entry), jsonb_build_object('voided', true), nullif(v_op->>'reason', ''), v_source, v_user);
        insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values (v_household, v_user, 'ledger_voided', 'ledger', v_entry.id);
      else
        v_new := coalesce(v_op->'changes', '{}'::jsonb);
        update public.ledger_entries set
          amount_paise = coalesce(nullif(v_new->>'amount_paise', '')::bigint, amount_paise),
          occurred_on_start = case when v_new ? 'occurred_on_start' then nullif(v_new->>'occurred_on_start', '')::date else occurred_on_start end,
          occurred_on_end = case when v_new ? 'occurred_on_start' then nullif(v_new->>'occurred_on_end', '')::date else occurred_on_end end,
          date_precision = coalesce(nullif(v_new->>'date_precision', ''), date_precision),
          date_expression = case when v_new ? 'date_expression' then nullif(v_new->>'date_expression', '') else date_expression end,
          description_en = coalesce(nullif(btrim(v_new->>'description_en'), ''), description_en),
          category_id = case when v_new ? 'category_name' then private.ledger_category(v_household, v_new->>'category_name') else category_id end,
          party_id = case when v_new ? 'party_name' then private.ledger_party(v_household, v_user, v_new->>'party_name', null) else party_id end,
          status = coalesce(nullif(v_new->>'status', ''), status),
          updated_at = now()
        where id = v_entry.id;
        insert into public.ledger_entry_history(household_id, entry_id, change_kind, previous_value, new_value, reason, source_message_id, changed_by_user_id)
          select v_household, v_entry.id, 'corrected', to_jsonb(v_entry), to_jsonb(e), nullif(v_op->>'reason', ''), v_source, v_user
          from public.ledger_entries e where e.id = v_entry.id;
        insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values (v_household, v_user, 'ledger_corrected', 'ledger', v_entry.id);
      end if;
      v_id := v_entry.id;
    else
      raise exception 'unsupported plan operation' using errcode = '22023';
    end case;
    if coalesce(v_op->>'ref', '') <> '' then v_refs := v_refs || jsonb_build_object(v_op->>'ref', v_id); end if;
    v_results := v_results || jsonb_build_object('op', v_op->>'op', 'id', v_id);
  end loop;

  -- Deferred checks (handover balances) run now, inside this transaction.
  set constraints all immediate;
  update public.family_plan_runs set result = jsonb_build_object('operations', v_results) where user_id = v_user and request_id = p_request_id;
  return jsonb_build_object('operations', v_results);
end
$$;

-- Totals in exact paise. Only actual, non-voided rows count. An approximate date
-- range that crosses the period boundary is reported separately, never guessed
-- into the period. Allocations classify a handover; they are not extra cash.
create or replace function public.get_gurtu_ledger_report(
  p_from date default null,
  p_to date default null,
  p_party_id uuid default null
)
returns jsonb
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  with actual as (
    select e.*, case
      when p_from is null and p_to is null then 'in'
      when e.occurred_on_start is null then 'uncertain'
      when e.occurred_on_start >= coalesce(p_from, '-infinity'::date) and coalesce(e.occurred_on_end, e.occurred_on_start) < coalesce(p_to, 'infinity'::date) then 'in'
      when coalesce(e.occurred_on_end, e.occurred_on_start) < coalesce(p_from, '-infinity'::date) or e.occurred_on_start >= coalesce(p_to, 'infinity'::date) then 'out'
      else 'uncertain' end as period_fit
    from public.ledger_entries e
    where e.voided_at is null and e.status = 'actual' and (p_party_id is null or e.party_id = p_party_id)
  ),
  in_period as (select * from actual where period_fit = 'in'),
  allocations as (
    select a.*, h.period_fit from public.ledger_allocations a join actual h on h.id = a.handover_entry_id
    where a.voided_at is null and h.period_fit = 'in'
  ),
  handovers as (
    select h.id, h.description_en, h.amount_paise, h.occurred_on_start, p.name as party,
      coalesce((select sum(a.amount_paise) from public.ledger_allocations a where a.handover_entry_id = h.id and a.voided_at is null), 0) as allocated,
      coalesce((select sum(r.amount_paise) from public.ledger_entries r where r.handover_entry_id = h.id and r.voided_at is null), 0) as returned
    from public.ledger_entries h left join public.ledger_parties p on p.id = h.party_id
    where h.nature = 'cash_handover' and h.status = 'actual' and h.voided_at is null and (p_party_id is null or h.party_id = p_party_id)
  ),
  planned as (
    select e.id, e.description_en, e.amount_paise, e.due_on, e.status, p.name as party from public.ledger_entries e
    left join public.ledger_parties p on p.id = e.party_id
    where e.status in ('planned', 'estimate') and e.voided_at is null and (p_party_id is null or e.party_id = p_party_id)
      and not exists (select 1 from public.ledger_entries f where f.fulfils_entry_id = e.id and f.voided_at is null)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'cash_in_paise', coalesce((select sum(amount_paise) from in_period where direction = 'in'), 0),
    'cash_out_paise', coalesce((select sum(amount_paise) from in_period where direction = 'out'), 0),
    'income_paise', coalesce((select sum(amount_paise) from in_period where nature = 'income'), 0),
    'operating_expense_paise', coalesce((select sum(amount_paise) from in_period where nature = 'operating_expense'), 0),
    'handover_purchases_paise', coalesce((select sum(amount_paise) from allocations where kind in ('farm_purchase', 'household_purchase')), 0),
    'personal_payments_paise', coalesce((select sum(amount_paise) from in_period where nature = 'personal_payment'), 0)
      + coalesce((select sum(amount_paise) from allocations where kind = 'personal'), 0),
    'interest_paise', coalesce((select sum(amount_paise) from in_period where nature = 'interest_payment'), 0),
    'loans_received_paise', coalesce((select sum(amount_paise) from in_period where nature = 'loan_received'), 0),
    'principal_repaid_paise', coalesce((select sum(amount_paise) from in_period where nature = 'loan_principal_repayment'), 0),
    'handovers_given_paise', coalesce((select sum(amount_paise) from in_period where nature = 'cash_handover'), 0),
    'cash_returned_paise', coalesce((select sum(amount_paise) from in_period where nature = 'cash_returned'), 0),
    'uncertain_period', jsonb_build_object('count', (select count(*) from actual where period_fit = 'uncertain'),
      'paise', coalesce((select sum(amount_paise) from actual where period_fit = 'uncertain'), 0)),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'paise', paise) order by paise desc) from (
      select coalesce(c.name, 'Uncategorised') as name, sum(x.amount_paise) as paise from (
        select category_id, amount_paise from in_period where nature in ('operating_expense', 'interest_payment')
        union all select category_id, amount_paise from allocations where kind in ('farm_purchase', 'household_purchase')
      ) x left join public.ledger_categories c on c.id = x.category_id group by 1) t), '[]'::jsonb),
    'by_party', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'paid_out_paise', paid_out, 'received_paise', received) order by paid_out desc) from (
      select p.name, sum(case when e.direction = 'out' then e.amount_paise else 0 end) as paid_out, sum(case when e.direction = 'in' then e.amount_paise else 0 end) as received
      from in_period e join public.ledger_parties p on p.id = e.party_id group by p.name) t), '[]'::jsonb),
    'open_handovers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'description', description_en, 'party', party, 'date', occurred_on_start,
      'amount_paise', amount_paise, 'allocated_paise', allocated, 'returned_paise', returned, 'remaining_paise', amount_paise - allocated - returned,
      'status', case when allocated + returned = 0 then 'not_settled' else 'partially_settled' end) order by occurred_on_start)
      from handovers where amount_paise - allocated - returned > 0), '[]'::jsonb),
    'settled_handovers', (select count(*) from handovers where amount_paise - allocated - returned = 0),
    'planned', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'description', description_en, 'party', party, 'due_on', due_on,
      'amount_paise', amount_paise, 'status', status) order by due_on nulls last) from planned), '[]'::jsonb)
  )
$$;

revoke all on function public.apply_gurtu_family_plan(uuid, uuid, text, jsonb), public.get_gurtu_ledger_report(date, date, uuid) from public, anon;
grant execute on function public.apply_gurtu_family_plan(uuid, uuid, text, jsonb), public.get_gurtu_ledger_report(date, date, uuid) to authenticated;
revoke all on function private.check_handover_balance(uuid), private.ledger_balance_trigger(), private.ledger_party(uuid, uuid, text, text),
  private.ledger_category(uuid, text), private.stamp_list_item_completion() from public, anon, authenticated;

notify pgrst, 'reload schema';
