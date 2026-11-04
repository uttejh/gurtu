-- Stage 1: separate conversations with server-side, idempotent message persistence.
--
-- * Every chat message now belongs to a conversation owned by one login.
-- * Existing history moves into one "Earlier chat" per login; nothing is deleted.
-- * The server receipt time (created_at) is authoritative and set by the database.
-- * process-message saves the user's words before any AI work, keyed by a
--   client message ID, so a retry returns the same result instead of acting twice.
-- * Direct inserts from older app versions keep working: they are assigned to the
--   login's most recent conversation. A later migration can revoke that path.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null default 'New chat' check (length(trim(title)) between 1 and 120),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_activity_idx on public.conversations(user_id, last_activity_at desc);
create index conversations_household_idx on public.conversations(household_id);
alter table public.conversations enable row level security;
revoke all on public.conversations from public, anon, authenticated;
grant select on public.conversations to authenticated;
create policy conversations_read_owner on public.conversations for select to authenticated
  using (user_id = auth.uid());

alter table public.talk_messages
  add column conversation_id uuid references public.conversations(id) on delete cascade,
  add column client_message_id uuid,
  add column reply_to_message_id uuid references public.talk_messages(id) on delete set null,
  add column input_type text check (input_type is null or input_type in ('text', 'voice')),
  add column language_code text check (language_code is null or length(language_code) between 2 and 20),
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');

-- Move each login's existing history into one earlier conversation.
insert into public.conversations(user_id, household_id, title, created_at, updated_at, last_activity_at)
select m.user_id, p.household_id, 'Earlier chat', min(m.created_at), max(m.created_at), max(m.created_at)
from public.talk_messages m
join public.profiles p on p.user_id = m.user_id
group by m.user_id, p.household_id;

update public.talk_messages m set conversation_id = c.id
from public.conversations c
where c.user_id = m.user_id and m.conversation_id is null;

alter table public.talk_messages alter column conversation_id set not null;

create index talk_messages_conversation_created_idx on public.talk_messages(conversation_id, created_at);
create unique index talk_messages_client_message_idx on public.talk_messages(user_id, client_message_id)
  where client_message_id is not null;
create unique index talk_messages_reply_idx on public.talk_messages(reply_to_message_id)
  where reply_to_message_id is not null;

-- Reading stays limited to the message owner by the existing talk_messages_read_self policy.

create or replace function private.prepare_talk_message()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_household uuid;
  v_conversation uuid;
begin
  -- The database receipt time is authoritative, never a client-supplied clock.
  new.created_at := clock_timestamp();
  if new.conversation_id is null then
    select c.id into v_conversation from public.conversations c
      where c.user_id = new.user_id order by c.last_activity_at desc limit 1;
    if v_conversation is null then
      select p.household_id into v_household from public.profiles p where p.user_id = new.user_id;
      if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
      insert into public.conversations(user_id, household_id) values (new.user_id, v_household)
        returning id into v_conversation;
    end if;
    new.conversation_id := v_conversation;
  elsif not exists (
    select 1 from public.conversations c where c.id = new.conversation_id and c.user_id = new.user_id
  ) then
    raise exception 'conversation is not available' using errcode = '42501';
  end if;
  if new.reply_to_message_id is not null and not exists (
    select 1 from public.talk_messages m
    where m.id = new.reply_to_message_id and m.user_id = new.user_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply target is not available' using errcode = '42501';
  end if;
  update public.conversations set last_activity_at = new.created_at, updated_at = new.created_at
    where id = new.conversation_id;
  return new;
end
$$;

create trigger talk_messages_prepare before insert on public.talk_messages
  for each row execute function private.prepare_talk_message();

-- Saves the user's words before any AI work. Calling it again with the same
-- client message ID returns the original message instead of saving a copy.
create or replace function public.start_gurtu_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_content text,
  p_input_type text,
  p_language_code text,
  p_title text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (conversation_id uuid, message_id uuid, created boolean)
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_conversation uuid;
  v_message uuid;
  v_existing_id uuid;
  v_existing_conversation uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_client_message_id is null or length(trim(coalesce(p_content, ''))) not between 1 and 8000
    or p_input_type is null or p_input_type not in ('text', 'voice')
    or (p_language_code is not null and length(p_language_code) not between 2 and 20)
    or length(trim(coalesce(p_title, ''))) not between 1 and 120
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'invalid message' using errcode = '22023';
  end if;
  select p.household_id into v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;

  select m.id, m.conversation_id into v_existing_id, v_existing_conversation
    from public.talk_messages m where m.user_id = v_user and m.client_message_id = p_client_message_id;
  if v_existing_id is not null then
    if p_conversation_id is not null and p_conversation_id <> v_existing_conversation then
      raise exception 'message ID already used' using errcode = '23505';
    end if;
    return query select v_existing_conversation, v_existing_id, false;
    return;
  end if;

  if p_conversation_id is null then
    insert into public.conversations(user_id, household_id, title)
      values (v_user, v_household, trim(p_title)) returning id into v_conversation;
  else
    select c.id into v_conversation from public.conversations c
      where c.id = p_conversation_id and c.user_id = v_user for update;
    if v_conversation is null then raise exception 'conversation is not available' using errcode = '42501'; end if;
  end if;

  insert into public.talk_messages(user_id, conversation_id, role, content, client_message_id, input_type, language_code, metadata)
  values (v_user, v_conversation, 'user', p_content, p_client_message_id, p_input_type, p_language_code, p_metadata)
  on conflict (user_id, client_message_id) where client_message_id is not null do nothing
  returning id into v_message;
  if v_message is null then
    -- A simultaneous request with the same ID won the race; roll back this one.
    raise exception 'message is already being processed' using errcode = '40001';
  end if;
  return query select v_conversation, v_message, true;
end
$$;

-- Saves exactly one assistant reply for a message (a user message or a
-- confirmation question). A repeated call returns the reply already saved.
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
    or (p_result_type is not null and p_result_type not in ('memory', 'list', 'event', 'answer'))
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

-- Records "Keep it" for a removal or deletion that was waiting for confirmation.
create or replace function public.cancel_gurtu_capture(p_request_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null then raise exception 'invalid capture' using errcode = '22023'; end if;
  update public.capture_requests set processing_status = 'cancelled', updated_at = now()
  where submitted_by_user_id = v_user and request_id = p_request_id
    and processing_status in ('awaiting_confirmation', 'operation_failed')
    and not exists (select 1 from public.operation_requests o where o.user_id = v_user and o.request_id = p_request_id and o.record_id is not null);
  return found;
end
$$;

revoke all on function public.start_gurtu_message(uuid, uuid, text, text, text, text, jsonb),
  public.record_gurtu_reply(uuid, text, text, uuid, jsonb, jsonb),
  public.cancel_gurtu_capture(uuid) from public, anon;
grant execute on function public.start_gurtu_message(uuid, uuid, text, text, text, text, jsonb),
  public.record_gurtu_reply(uuid, text, text, uuid, jsonb, jsonb),
  public.cancel_gurtu_capture(uuid) to authenticated;
revoke all on function private.prepare_talk_message() from public, anon, authenticated;

notify pgrst, 'reload schema';
