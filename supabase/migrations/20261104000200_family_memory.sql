-- Stage 2: rolling conversation summaries and household-shared family recall.
--
-- * Each conversation keeps one rolling English summary with a version and a
--   cursor, so summary work can be retried and never skips messages.
-- * family_memories holds what Gurtu can recall across chats in a household:
--   - 'saved_memory': the English interpretation of a saved memory row;
--   - 'conversation': a durable fact, plan or decision taken from a chat.
--   Conversation-derived rows keep only the English interpretation and source
--   references, never the private transcript text.
-- * memory_index_jobs is a small durable work queue. Triggers add work when a
--   reply or a memory is saved; process-message drains the caller's own jobs
--   after it replies. Failed jobs stay queued for retry.
-- * Embeddings use one fixed model and dimension per index (1536).

create extension if not exists vector with schema extensions;

alter table public.conversations
  add column summary_en text check (summary_en is null or length(summary_en) <= 6000),
  add column summary_version integer not null default 0 check (summary_version >= 0),
  add column summary_through_message_id uuid references public.talk_messages(id) on delete set null,
  add column summary_through_at timestamptz,
  add column summary_updated_at timestamptz;

create table public.family_memories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_kind text not null check (source_kind in ('saved_memory', 'conversation')),
  memory_id uuid references public.memories(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  source_message_ids uuid[] not null default '{}',
  original_text text check (original_text is null or length(original_text) <= 8000),
  original_language text check (original_language is null or length(original_language) between 2 and 20),
  english_text text not null check (length(trim(english_text)) between 1 and 1000),
  memory_type text not null check (memory_type in ('fact', 'plan', 'decision', 'completed_action', 'preference', 'other')),
  status text not null default 'current' check (status in ('current', 'superseded', 'completed', 'uncertain')),
  superseded_by uuid references public.family_memories(id) on delete set null,
  people_ids uuid[] not null default '{}',
  occurred_on_start date,
  occurred_on_end date,
  date_precision text check (date_precision is null or date_precision in ('exact', 'approximate', 'unknown')),
  speaker_name text check (speaker_name is null or length(speaker_name) <= 80),
  created_by_user_id uuid references auth.users(id) on delete set null,
  embedding extensions.vector(1536),
  embedding_model text check (embedding_model is null or length(embedding_model) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_kind <> 'saved_memory' or memory_id is not null),
  check (source_kind <> 'conversation' or (original_text is null and conversation_id is not null)),
  check (occurred_on_end is null or occurred_on_start is null or occurred_on_end >= occurred_on_start)
);
create unique index family_memories_saved_memory_idx on public.family_memories(memory_id) where memory_id is not null;
create index family_memories_household_status_idx on public.family_memories(household_id, status, created_at desc);
create index family_memories_search_idx on public.family_memories
  using gin (to_tsvector('simple', english_text || ' ' || coalesce(original_text, '')));
create index family_memories_embedding_idx on public.family_memories
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.family_memories enable row level security;
revoke all on public.family_memories from public, anon, authenticated;
grant select on public.family_memories to authenticated;
-- Shared recall is household-wide by design; there is deliberately no
-- cross-household administrator policy for this table.
create policy family_memories_read_household on public.family_memories for select to authenticated
  using (household_id = private.current_household_id());

create table public.memory_index_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  job_type text not null check (job_type in ('conversation_turn', 'saved_memory')),
  conversation_id uuid references public.conversations(id) on delete cascade,
  target_message_id uuid references public.talk_messages(id) on delete cascade,
  memory_id uuid references public.memories(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 500),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((job_type = 'conversation_turn' and conversation_id is not null) or (job_type = 'saved_memory' and memory_id is not null))
);
create unique index memory_index_jobs_conversation_idx on public.memory_index_jobs(conversation_id)
  where job_type = 'conversation_turn' and status in ('pending', 'running', 'failed');
create unique index memory_index_jobs_memory_idx on public.memory_index_jobs(memory_id) where job_type = 'saved_memory';
create index memory_index_jobs_user_status_idx on public.memory_index_jobs(user_id, status, created_at);
alter table public.memory_index_jobs enable row level security;
revoke all on public.memory_index_jobs from public, anon, authenticated;

-- One open summary job per conversation: a newer reply moves its target forward.
create or replace function private.enqueue_conversation_index()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_household uuid;
begin
  if new.role <> 'assistant' or new.reply_to_message_id is null then return new; end if;
  select c.household_id into v_household from public.conversations c where c.id = new.conversation_id;
  -- A running job that has not reached this reply goes back to pending when it finishes.
  -- A failed job gets a fresh set of attempts when the conversation continues.
  update public.memory_index_jobs set target_message_id = new.id, updated_at = now(),
    status = case when status = 'failed' then 'pending' else status end,
    attempts = case when status = 'failed' then 0 else attempts end
    where job_type = 'conversation_turn' and conversation_id = new.conversation_id and status in ('pending', 'running', 'failed');
  if not found then
    insert into public.memory_index_jobs(user_id, household_id, job_type, conversation_id, target_message_id)
      values (new.user_id, v_household, 'conversation_turn', new.conversation_id, new.id)
      on conflict do nothing;
  end if;
  return new;
end
$$;
create trigger talk_messages_enqueue_index after insert on public.talk_messages
  for each row execute function private.enqueue_conversation_index();

create or replace function private.enqueue_saved_memory_index()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  insert into public.memory_index_jobs(user_id, household_id, job_type, memory_id)
    values (new.created_by_user_id, new.household_id, 'saved_memory', new.id)
    on conflict do nothing;
  return new;
end
$$;
create trigger memories_enqueue_index after insert on public.memories
  for each row execute function private.enqueue_saved_memory_index();

-- Backfill: index existing saved memories and summarise existing conversations.
insert into public.memory_index_jobs(user_id, household_id, job_type, memory_id)
select m.created_by_user_id, m.household_id, 'saved_memory', m.id from public.memories m
on conflict do nothing;
insert into public.memory_index_jobs(user_id, household_id, job_type, conversation_id, target_message_id)
select c.user_id, c.household_id, 'conversation_turn', c.id,
  (select m.id from public.talk_messages m where m.conversation_id = c.id order by m.created_at desc limit 1)
from public.conversations c
where exists (select 1 from public.talk_messages m where m.conversation_id = c.id)
on conflict do nothing;

-- Claims up to p_limit of the caller's own jobs. A crashed run is retried after its lease.
create or replace function public.claim_gurtu_index_jobs(p_limit integer default 2)
returns table (id uuid, job_type text, conversation_id uuid, target_message_id uuid, memory_id uuid, attempts integer)
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return query
  with picked as (
    select j.id from public.memory_index_jobs j
    where j.user_id = v_user
      and (j.status = 'pending' or (j.status = 'failed' and j.attempts < 5) or (j.status = 'running' and j.locked_until < now()))
    order by j.created_at
    limit least(greatest(coalesce(p_limit, 2), 1), 5)
    for update skip locked
  )
  update public.memory_index_jobs j set status = 'running', attempts = j.attempts + 1,
    locked_until = now() + interval '3 minutes', updated_at = now()
  from picked where j.id = picked.id
  returning j.id, j.job_type, j.conversation_id, j.target_message_id, j.memory_id, j.attempts;
end
$$;

create or replace function public.fail_gurtu_index_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  update public.memory_index_jobs set status = 'failed', last_error = left(coalesce(p_error, 'unknown'), 500),
    locked_until = null, updated_at = now()
  where id = p_job_id and user_id = auth.uid() and status = 'running';
  return found;
end
$$;

-- Indexes one saved memory row for cross-chat recall.
create or replace function public.index_gurtu_saved_memory(
  p_job_id uuid,
  p_english_text text,
  p_embedding text,
  p_embedding_model text
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_job public.memory_index_jobs%rowtype;
  v_memory public.memories%rowtype;
  v_people uuid[];
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_job from public.memory_index_jobs where id = p_job_id and user_id = v_user and job_type = 'saved_memory' and status = 'running' for update;
  if v_job.id is null then raise exception 'index job is not available' using errcode = '42501'; end if;
  if length(trim(coalesce(p_english_text, ''))) not between 1 and 1000 then raise exception 'invalid memory text' using errcode = '22023'; end if;
  select * into v_memory from public.memories where id = v_job.memory_id and household_id = v_job.household_id;
  if v_memory.id is not null then
    select coalesce(array_agg(mp.person_id), '{}') into v_people from public.memory_people mp where mp.memory_id = v_memory.id;
    insert into public.family_memories(household_id, source_kind, memory_id, original_text, original_language, english_text,
      memory_type, status, people_ids, created_by_user_id, created_at, embedding, embedding_model)
    values (v_memory.household_id, 'saved_memory', v_memory.id, v_memory.original_text, v_memory.language, trim(p_english_text),
      'fact', 'current', v_people, v_memory.created_by_user_id, v_memory.created_at, p_embedding::extensions.vector(1536), p_embedding_model)
    on conflict (memory_id) where memory_id is not null do update set
      english_text = excluded.english_text, people_ids = excluded.people_ids, embedding = excluded.embedding,
      embedding_model = excluded.embedding_model, updated_at = now()
    returning id into v_id;
  end if;
  update public.memory_index_jobs set status = 'done', last_error = null, locked_until = null, updated_at = now() where id = v_job.id;
  return v_id;
end
$$;

-- Applies one summary step and the facts it found, atomically. Returns false,
-- changing nothing, if a newer summary was saved meanwhile.
create or replace function public.apply_gurtu_conversation_index(
  p_job_id uuid,
  p_expected_version integer,
  p_summary text,
  p_through_message_id uuid,
  p_memories jsonb default '[]'::jsonb,
  p_updates jsonb default '[]'::jsonb,
  p_embedding_model text default null
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
    or jsonb_typeof(coalesce(p_updates, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_updates, '[]'::jsonb)) > 12 then
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

  select m.created_at into v_target_at from public.talk_messages m where m.id = v_job.target_message_id;
  update public.memory_index_jobs set
    status = case when v_target_at is null or v_target_at <= v_through_at then 'done' else 'pending' end,
    last_error = null, locked_until = null, updated_at = now()
  where id = v_job.id;
  return true;
end
$$;

-- Hybrid household recall: vector similarity plus full-text match, fused by rank.
-- Runs with the caller's permissions, so RLS limits it to their household.
create or replace function public.match_gurtu_family_memories(
  p_embedding text,
  p_query text,
  p_limit integer default 8
)
returns table (
  id uuid, source_kind text, memory_id uuid, english_text text, original_text text, memory_type text, status text,
  speaker_name text, occurred_on_start date, occurred_on_end date, date_precision text, created_at timestamptz,
  similarity double precision, keyword_match boolean
)
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query as (
    select p_embedding::extensions.vector(1536) as embedding,
      case when length(trim(coalesce(p_query, ''))) > 0 then websearch_to_tsquery('simple', p_query) end as words
  ),
  by_vector as (
    select f.id, row_number() over (order by f.embedding <=> q.embedding) as rank
    from public.family_memories f, query q
    where f.embedding is not null and f.status <> 'superseded'
    order by f.embedding <=> q.embedding
    limit 24
  ),
  by_words as (
    select f.id, row_number() over (order by ts_rank(to_tsvector('simple', f.english_text || ' ' || coalesce(f.original_text, '')), q.words) desc) as rank
    from public.family_memories f, query q
    where q.words is not null and f.status <> 'superseded'
      and to_tsvector('simple', f.english_text || ' ' || coalesce(f.original_text, '')) @@ q.words
    limit 24
  ),
  fused as (
    select coalesce(v.id, w.id) as id,
      coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + w.rank), 0) as score,
      w.id is not null as keyword_match
    from by_vector v full outer join by_words w on w.id = v.id
  )
  select f.id, f.source_kind, f.memory_id, f.english_text, f.original_text, f.memory_type, f.status, f.speaker_name,
    f.occurred_on_start, f.occurred_on_end, f.date_precision, f.created_at,
    case when f.embedding is null then 0 else 1 - (f.embedding <=> q.embedding) end, fused.keyword_match
  from fused join public.family_memories f on f.id = fused.id, query q
  order by fused.score desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20)
$$;

revoke all on function public.claim_gurtu_index_jobs(integer), public.fail_gurtu_index_job(uuid, text),
  public.index_gurtu_saved_memory(uuid, text, text, text),
  public.apply_gurtu_conversation_index(uuid, integer, text, uuid, jsonb, jsonb, text),
  public.match_gurtu_family_memories(text, text, integer) from public, anon;
grant execute on function public.claim_gurtu_index_jobs(integer), public.fail_gurtu_index_job(uuid, text),
  public.index_gurtu_saved_memory(uuid, text, text, text),
  public.apply_gurtu_conversation_index(uuid, integer, text, uuid, jsonb, jsonb, text),
  public.match_gurtu_family_memories(text, text, integer) to authenticated;
revoke all on function private.enqueue_conversation_index(), private.enqueue_saved_memory_index() from public, anon, authenticated;

notify pgrst, 'reload schema';
