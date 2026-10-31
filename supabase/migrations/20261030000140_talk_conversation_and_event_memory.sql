create table public.talk_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(trim(content)) between 1 and 8000),
  result_type text check (result_type is null or result_type in ('memory', 'list', 'event', 'answer')),
  result_id uuid,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  created_at timestamptz not null default now()
);
create index talk_messages_user_created_idx on public.talk_messages(user_id, created_at);
alter table public.talk_messages enable row level security;
revoke all on public.talk_messages from public, anon, authenticated;
grant select, insert on public.talk_messages to authenticated;
create policy talk_messages_read_self on public.talk_messages for select to authenticated
  using (user_id = auth.uid());
create policy talk_messages_insert_self on public.talk_messages for insert to authenticated
  with check (user_id = auth.uid());

create or replace function public.save_gurtu_memory_and_event(
  p_original_text text,
  p_language text,
  p_summary text,
  p_person_ids uuid[],
  p_memory_request_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_is_all_day boolean,
  p_event_request_id uuid
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_event_id uuid;
begin
  if p_memory_request_id is null or p_event_request_id is null or p_memory_request_id = p_event_request_id then
    raise exception 'invalid memory and event request' using errcode = '22023';
  end if;
  perform public.save_gurtu_memory(p_original_text, p_language, p_summary, p_person_ids, p_memory_request_id);
  v_event_id := public.create_gurtu_event(p_title, null, p_starts_at, p_ends_at, p_timezone,
    p_is_all_day, p_person_ids, p_event_request_id);
  return v_event_id;
end
$$;
revoke all on function public.save_gurtu_memory_and_event(text, text, text, uuid[], uuid, text, timestamptz, timestamptz, text, boolean, uuid) from public, anon;
grant execute on function public.save_gurtu_memory_and_event(text, text, text, uuid[], uuid, text, timestamptz, timestamptz, text, boolean, uuid) to authenticated;
