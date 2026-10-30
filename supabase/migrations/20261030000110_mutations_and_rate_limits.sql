alter table public.operation_requests drop constraint operation_requests_record_type_check;
alter table public.operation_requests add constraint operation_requests_record_type_check
  check (record_type in ('memory', 'item', 'list', 'event', 'list_item_add', 'list_item_update', 'list_item_remove', 'event_update'));

create table public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('ai_interpret', 'ai_ask', 'transcription')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, bucket)
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_gurtu_rate_limit(p_bucket text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer;
  v_window integer := 60;
  v_count integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  v_limit := case p_bucket when 'ai_interpret' then 12 when 'ai_ask' then 20 when 'transcription' then 8 else null end;
  if v_limit is null then raise exception 'invalid rate limit bucket' using errcode = '22023'; end if;
  insert into public.api_rate_limits(user_id, bucket, request_count, window_started_at)
  values (v_user, p_bucket, 1, now())
  on conflict (user_id, bucket) do update set
    request_count = case
      when api_rate_limits.window_started_at <= now() - make_interval(secs => v_window) then 1
      else api_rate_limits.request_count + 1
    end,
    window_started_at = case
      when api_rate_limits.window_started_at <= now() - make_interval(secs => v_window) then now()
      else api_rate_limits.window_started_at
    end
  returning request_count into v_count;
  return v_count <= v_limit;
end
$$;

create or replace function public.change_gurtu_list_item(
  p_action text,
  p_list_id uuid,
  p_item_id uuid default null,
  p_item_text text default null,
  p_request_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private
set row_security = off
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_item_id uuid;
  v_record_type text;
  v_old_type text;
  v_old_id uuid;
  v_action text;
  v_position integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_action is null or p_action not in ('add', 'complete', 'uncomplete', 'remove') or p_request_id is null or p_list_id is null then
    raise exception 'invalid list change' using errcode = '22023';
  end if;
  if not private.can_access_list(p_list_id) then raise exception 'list is not available' using errcode = '42501'; end if;
  select household_id into v_household from public.profiles where user_id = v_user;
  if p_action = 'add' and length(trim(coalesce(p_item_text, ''))) not between 1 and 300 then
    raise exception 'invalid list item' using errcode = '22023';
  end if;
  v_record_type := case p_action when 'add' then 'list_item_add' when 'remove' then 'list_item_remove' else 'list_item_update' end;

  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, v_record_type) on conflict do nothing;
  select record_type, record_id into v_old_type, v_old_id
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_old_type <> v_record_type then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_old_id is not null then return v_old_id; end if;

  if p_action = 'add' then
    select coalesce(max(position), 0) + 1 into v_position from public.list_items where list_id = p_list_id;
    insert into public.list_items(list_id, item_text, created_by_user_id, request_id, position)
    values (p_list_id, trim(p_item_text), v_user, p_request_id, v_position)
    returning id into v_item_id;
    v_action := 'list_item_added';
  else
    if p_item_id is null then raise exception 'list item required' using errcode = '22023'; end if;
    select id into v_item_id from public.list_items where id = p_item_id and list_id = p_list_id for update;
    if v_item_id is null then raise exception 'list item is not available' using errcode = '42501'; end if;
    if p_action = 'remove' then
      delete from public.list_items where id = v_item_id;
      v_action := 'list_item_removed';
    else
      update public.list_items set is_completed = (p_action = 'complete'), updated_at = now() where id = v_item_id;
      v_action := case when p_action = 'complete' then 'list_item_completed' else 'list_item_uncompleted' end;
    end if;
  end if;

  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
  values (v_household, v_user, v_action, 'list_item', v_item_id);
  update public.operation_requests set record_id = v_item_id where user_id = v_user and request_id = p_request_id;
  return v_item_id;
end
$$;

create or replace function public.update_gurtu_event(
  p_event_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_is_all_day boolean,
  p_request_id uuid default gen_random_uuid()
)
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
  if p_event_id is null or p_request_id is null or length(trim(coalesce(p_title, ''))) not between 1 and 160
    or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or length(coalesce(p_timezone, '')) not between 1 and 80 then
    raise exception 'invalid event change' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid event time zone' using errcode = '22023';
  end if;
  select household_id into v_household from public.profiles where user_id = v_user;
  select owner_household_id into v_owner from public.events where id = p_event_id;
  if v_owner is null or v_owner <> v_household then raise exception 'event is not editable by this household' using errcode = '42501'; end if;
  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, 'event_update') on conflict do nothing;
  select record_type, record_id into v_old_type, v_old_id
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_old_type <> 'event_update' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_old_id is not null then return v_old_id; end if;
  update public.events set title = trim(p_title), starts_at = p_starts_at, ends_at = p_ends_at,
    timezone = p_timezone, is_all_day = coalesce(p_is_all_day, false), updated_at = now()
    where id = p_event_id and owner_household_id = v_household;
  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
    values (v_household, v_user, 'event_updated', 'event', p_event_id);
  update public.operation_requests set record_id = p_event_id where user_id = v_user and request_id = p_request_id;
  return p_event_id;
end
$$;

revoke all on function public.consume_gurtu_rate_limit(text), public.change_gurtu_list_item(text, uuid, uuid, text, uuid), public.update_gurtu_event(uuid, text, timestamptz, timestamptz, text, boolean, uuid) from public, anon;
grant execute on function public.consume_gurtu_rate_limit(text), public.change_gurtu_list_item(text, uuid, uuid, text, uuid), public.update_gurtu_event(uuid, text, timestamptz, timestamptz, text, boolean, uuid) to authenticated;
