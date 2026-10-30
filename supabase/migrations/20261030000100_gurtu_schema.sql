create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  timezone text not null check (length(timezone) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (family_id, name),
  unique (id, family_id)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  household_id uuid not null,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (household_id, family_id) references public.households(id, family_id) on delete cascade
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  home_household_id uuid not null,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  foreign key (home_household_id, family_id) references public.households(id, family_id) on delete restrict,
  unique (id, family_id),
  check (cardinality(aliases) <= 30)
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  original_text text not null check (length(trim(original_text)) between 1 and 8000),
  language text not null default 'und' check (length(language) between 2 and 20),
  summary text check (summary is null or length(summary) <= 300),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by_user_id, request_id),
  unique (id, household_id)
);

create table public.memory_people (
  memory_id uuid not null references public.memories(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  tag_type text not null default 'mentioned' check (tag_type in ('mentioned', 'about')),
  primary key (memory_id, person_id)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  canonical_name text not null check (length(trim(canonical_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, canonical_name),
  unique (id, household_id)
);

create table public.item_people (
  item_id uuid not null references public.items(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  primary key (item_id, person_id)
);

create table public.item_location_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid not null,
  location_text text not null check (length(trim(location_text)) between 1 and 500),
  source_memory_id uuid,
  recorded_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (item_id, household_id) references public.items(id, household_id) on delete cascade,
  foreign key (source_memory_id, household_id) references public.memories(id, household_id) on delete restrict
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by_user_id, request_id),
  unique (id, owner_household_id)
);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  item_text text not null check (length(trim(item_text)) between 1 and 300),
  is_completed boolean not null default false,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  position integer not null default 0 check (position >= 0),
  unique (created_by_user_id, request_id)
);

create table public.list_people (
  list_id uuid not null references public.lists(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  primary key (list_id, person_id)
);

create table public.list_household_access (
  list_id uuid not null references public.lists(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (list_id, household_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check (length(timezone) between 1 and 80),
  is_all_day boolean not null default false,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (created_by_user_id, request_id),
  unique (id, owner_household_id)
);

create table public.event_people (
  event_id uuid not null references public.events(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  primary key (event_id, person_id)
);

create table public.event_household_access (
  event_id uuid not null references public.events(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, household_id)
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'memory_saved', 'item_location_changed', 'list_created', 'list_item_added',
    'list_item_completed', 'list_item_uncompleted', 'list_item_removed',
    'event_created', 'event_updated'
  )),
  record_type text not null check (record_type in ('memory', 'item', 'list', 'list_item', 'event')),
  record_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.operation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  record_type text not null check (record_type in ('memory', 'item', 'list', 'event')),
  record_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index households_family_idx on public.households(family_id);
create index profiles_household_idx on public.profiles(household_id);
create index people_family_active_idx on public.people(family_id, is_active, display_name);
create index memories_household_created_idx on public.memories(household_id, created_at desc);
create index memories_search_idx on public.memories using gin (to_tsvector('simple', original_text));
create index memory_people_person_idx on public.memory_people(person_id, memory_id);
create index items_household_name_idx on public.items(household_id, canonical_name);
create index item_people_person_idx on public.item_people(person_id, item_id);
create index item_location_latest_idx on public.item_location_history(household_id, item_id, created_at desc);
create index lists_owner_created_idx on public.lists(owner_household_id, created_at desc);
create index list_items_list_position_idx on public.list_items(list_id, position, created_at);
create index list_people_person_idx on public.list_people(person_id, list_id);
create index list_access_household_idx on public.list_household_access(household_id, list_id);
create index events_owner_start_idx on public.events(owner_household_id, starts_at);
create index events_end_idx on public.events(ends_at);
create index event_people_person_idx on public.event_people(person_id, event_id);
create index event_access_household_idx on public.event_household_access(household_id, event_id);
create index activity_household_created_idx on public.activity_log(household_id, created_at desc);

create or replace function private.current_family_id()
returns uuid
language sql stable security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select p.family_id from public.profiles p where p.user_id = auth.uid()
$$;

create or replace function private.current_household_id()
returns uuid
language sql stable security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select p.household_id from public.profiles p where p.user_id = auth.uid()
$$;

create or replace function private.can_access_list(p_list_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.lists l
    where l.id = p_list_id
      and (l.owner_household_id = private.current_household_id()
        or exists (
          select 1 from public.list_household_access a
          where a.list_id = l.id and a.household_id = private.current_household_id()
        ))
  )
$$;

create or replace function private.can_access_event(p_event_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and (e.owner_household_id = private.current_household_id()
        or exists (
          select 1 from public.event_household_access a
          where a.event_id = e.id and a.household_id = private.current_household_id()
        ))
  )
$$;

revoke all on function private.current_family_id(), private.current_household_id(), private.can_access_list(uuid), private.can_access_event(uuid) from public, anon;
grant execute on function private.current_family_id(), private.current_household_id(), private.can_access_list(uuid), private.can_access_event(uuid) to authenticated;

alter table public.families enable row level security;
alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.memories enable row level security;
alter table public.memory_people enable row level security;
alter table public.items enable row level security;
alter table public.item_people enable row level security;
alter table public.item_location_history enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.list_people enable row level security;
alter table public.list_household_access enable row level security;
alter table public.events enable row level security;
alter table public.event_people enable row level security;
alter table public.event_household_access enable row level security;
alter table public.activity_log enable row level security;
alter table public.operation_requests enable row level security;

create policy family_read on public.families for select to authenticated
  using (id = private.current_family_id());
create policy household_read_family on public.households for select to authenticated
  using (family_id = private.current_family_id());
create policy profile_read_self on public.profiles for select to authenticated
  using (user_id = auth.uid());
create policy people_read_family on public.people for select to authenticated
  using (family_id = private.current_family_id());

create policy memories_read_household on public.memories for select to authenticated
  using (household_id = private.current_household_id());
create policy memories_insert_household on public.memories for insert to authenticated
  with check (household_id = private.current_household_id() and created_by_user_id = auth.uid());
create policy memories_update_household on public.memories for update to authenticated
  using (household_id = private.current_household_id())
  with check (household_id = private.current_household_id() and created_by_user_id = auth.uid());
create policy memories_delete_household on public.memories for delete to authenticated
  using (household_id = private.current_household_id());

create policy memory_people_read on public.memory_people for select to authenticated
  using (exists (select 1 from public.memories m where m.id = memory_id and m.household_id = private.current_household_id()));
create policy memory_people_insert on public.memory_people for insert to authenticated
  with check (exists (select 1 from public.memories m where m.id = memory_id and m.household_id = private.current_household_id())
    and exists (select 1 from public.people p where p.id = person_id and p.family_id = private.current_family_id()));
create policy memory_people_delete on public.memory_people for delete to authenticated
  using (exists (select 1 from public.memories m where m.id = memory_id and m.household_id = private.current_household_id()));

create policy items_read_household on public.items for select to authenticated
  using (household_id = private.current_household_id());
create policy items_insert_household on public.items for insert to authenticated
  with check (household_id = private.current_household_id());
create policy items_update_household on public.items for update to authenticated
  using (household_id = private.current_household_id()) with check (household_id = private.current_household_id());
create policy items_delete_household on public.items for delete to authenticated
  using (household_id = private.current_household_id());

create policy item_people_read on public.item_people for select to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.household_id = private.current_household_id()));
create policy item_people_insert on public.item_people for insert to authenticated
  with check (exists (select 1 from public.items i where i.id = item_id and i.household_id = private.current_household_id())
    and exists (select 1 from public.people p where p.id = person_id and p.family_id = private.current_family_id()));
create policy item_people_delete on public.item_people for delete to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.household_id = private.current_household_id()));

create policy item_location_read_household on public.item_location_history for select to authenticated
  using (household_id = private.current_household_id());
create policy item_location_insert_household on public.item_location_history for insert to authenticated
  with check (household_id = private.current_household_id() and recorded_by_user_id = auth.uid());
create policy item_location_delete_household on public.item_location_history for delete to authenticated
  using (household_id = private.current_household_id());

create policy lists_read_access on public.lists for select to authenticated using (private.can_access_list(id));
create policy lists_insert_owner on public.lists for insert to authenticated
  with check (owner_household_id = private.current_household_id() and created_by_user_id = auth.uid());
create policy lists_update_owner on public.lists for update to authenticated
  using (owner_household_id = private.current_household_id()) with check (owner_household_id = private.current_household_id());
create policy lists_delete_owner on public.lists for delete to authenticated
  using (owner_household_id = private.current_household_id());

create policy list_items_read_access on public.list_items for select to authenticated using (private.can_access_list(list_id));
create policy list_items_insert_access on public.list_items for insert to authenticated
  with check (private.can_access_list(list_id) and created_by_user_id = auth.uid());
create policy list_items_update_access on public.list_items for update to authenticated
  using (private.can_access_list(list_id)) with check (private.can_access_list(list_id));
create policy list_items_delete_access on public.list_items for delete to authenticated
  using (private.can_access_list(list_id));
create policy list_people_read_access on public.list_people for select to authenticated using (private.can_access_list(list_id));
create policy list_access_read_access on public.list_household_access for select to authenticated using (private.can_access_list(list_id));

create policy events_read_access on public.events for select to authenticated using (private.can_access_event(id));
create policy events_insert_owner on public.events for insert to authenticated
  with check (owner_household_id = private.current_household_id() and created_by_user_id = auth.uid());
create policy events_update_owner on public.events for update to authenticated
  using (owner_household_id = private.current_household_id()) with check (owner_household_id = private.current_household_id());
create policy events_delete_owner on public.events for delete to authenticated
  using (owner_household_id = private.current_household_id());
create policy event_people_read_access on public.event_people for select to authenticated using (private.can_access_event(event_id));
create policy event_access_read_access on public.event_household_access for select to authenticated using (private.can_access_event(event_id));

create policy activity_read_household on public.activity_log for select to authenticated
  using (household_id = private.current_household_id());

revoke all on public.families, public.households, public.profiles, public.people,
  public.memories, public.memory_people, public.items, public.item_people,
  public.item_location_history, public.lists, public.list_items, public.list_people,
  public.list_household_access, public.events, public.event_people,
  public.event_household_access, public.activity_log, public.operation_requests
  from anon, authenticated;

grant select on public.families, public.households, public.profiles, public.people to authenticated;
grant select on public.memories, public.memory_people, public.items, public.item_people,
  public.item_location_history, public.lists, public.list_items, public.list_people,
  public.list_household_access, public.events, public.event_people,
  public.event_household_access, public.activity_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function public.create_gurtu_list(
  p_title text,
  p_person_ids uuid[] default '{}',
  p_items text[] default '{}',
  p_request_id uuid default gen_random_uuid()
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
  v_list_id uuid;
  v_duplicate_type text;
  v_person_count integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'invalid list request' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_person_ids, '{}')) > 100 or cardinality(coalesce(p_items, '{}')) > 100 then
    raise exception 'too many list entries' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_items, '{}')) x where length(trim(x)) not between 1 and 300) then
    raise exception 'invalid list item' using errcode = '22023';
  end if;
  select p.family_id, p.household_id into v_family, v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
  if exists (
    select 1 from unnest(coalesce(p_person_ids, '{}')) x
    left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person is not in this family' using errcode = '42501'; end if;

  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, 'list') on conflict do nothing;
  select record_type, record_id into v_duplicate_type, v_list_id
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_duplicate_type <> 'list' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_list_id is not null then return v_list_id; end if;

  insert into public.lists(owner_household_id, title, created_by_user_id, request_id)
  values (v_household, trim(p_title), v_user, p_request_id) returning id into v_list_id;
  insert into public.list_people(list_id, person_id)
  select v_list_id, p.id from public.people p
    where p.id = any(coalesce(p_person_ids, '{}')) and p.family_id = v_family
  on conflict do nothing;
  insert into public.list_household_access(list_id, household_id, granted_by_user_id)
  select distinct v_list_id, p.home_household_id, v_user from public.people p
    where p.id = any(coalesce(p_person_ids, '{}')) and p.home_household_id <> v_household
  on conflict do nothing;
  insert into public.list_items(list_id, item_text, created_by_user_id, request_id, position)
  select v_list_id, trim(x.item_text), v_user, gen_random_uuid(), x.ordinality::integer
    from unnest(coalesce(p_items, '{}')) with ordinality as x(item_text, ordinality);
  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
  values (v_household, v_user, 'list_created', 'list', v_list_id);
  update public.operation_requests set record_id = v_list_id where user_id = v_user and request_id = p_request_id;
  return v_list_id;
end
$$;

create or replace function public.create_gurtu_event(
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_is_all_day boolean,
  p_person_ids uuid[] default '{}',
  p_request_id uuid default gen_random_uuid()
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
  v_event_id uuid;
  v_duplicate_type text;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or length(trim(coalesce(p_title, ''))) not between 1 and 160
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or length(coalesce(p_timezone, '')) not between 1 and 80
     or length(coalesce(p_description, '')) > 2000 then
    raise exception 'invalid event request' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid event time zone' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_person_ids, '{}')) > 100 then raise exception 'too many people' using errcode = '22023'; end if;
  select p.family_id, p.household_id into v_family, v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
  if exists (
    select 1 from unnest(coalesce(p_person_ids, '{}')) x
    left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person is not in this family' using errcode = '42501'; end if;

  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, 'event') on conflict do nothing;
  select record_type, record_id into v_duplicate_type, v_event_id
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_duplicate_type <> 'event' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_event_id is not null then return v_event_id; end if;

  insert into public.events(owner_household_id, title, description, starts_at, ends_at, timezone, is_all_day, created_by_user_id, request_id)
  values (v_household, trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_starts_at, p_ends_at,
    p_timezone, coalesce(p_is_all_day, false), v_user, p_request_id)
  returning id into v_event_id;
  insert into public.event_people(event_id, person_id)
  select v_event_id, p.id from public.people p
    where p.id = any(coalesce(p_person_ids, '{}')) and p.family_id = v_family
  on conflict do nothing;
  insert into public.event_household_access(event_id, household_id, granted_by_user_id)
  select distinct v_event_id, p.home_household_id, v_user from public.people p
    where p.id = any(coalesce(p_person_ids, '{}')) and p.home_household_id <> v_household
  on conflict do nothing;
  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
  values (v_household, v_user, 'event_created', 'event', v_event_id);
  update public.operation_requests set record_id = v_event_id where user_id = v_user and request_id = p_request_id;
  return v_event_id;
end
$$;

create or replace function public.save_gurtu_memory(
  p_original_text text,
  p_language text,
  p_summary text,
  p_person_ids uuid[],
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
  v_memory_id uuid;
  v_duplicate_type text;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or length(trim(coalesce(p_original_text, ''))) not between 1 and 8000
     or length(coalesce(p_language, 'und')) > 20 or length(coalesce(p_summary, '')) > 300 then
    raise exception 'invalid memory request' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_person_ids, '{}')) > 100 then raise exception 'too many people' using errcode = '22023'; end if;
  select p.family_id, p.household_id into v_family, v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
  if exists (
    select 1 from unnest(coalesce(p_person_ids, '{}')) x
    left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person is not in this family' using errcode = '42501'; end if;

  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, 'memory') on conflict do nothing;
  select record_type, record_id into v_duplicate_type, v_memory_id
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_duplicate_type <> 'memory' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_memory_id is not null then return v_memory_id; end if;

  insert into public.memories(household_id, created_by_user_id, original_text, language, summary, request_id)
  values (v_household, v_user, p_original_text, coalesce(nullif(p_language, ''), 'und'), nullif(trim(coalesce(p_summary, '')), ''), p_request_id)
  returning id into v_memory_id;
  insert into public.memory_people(memory_id, person_id)
  select v_memory_id, p.id from public.people p where p.id = any(coalesce(p_person_ids, '{}')) and p.family_id = v_family
  on conflict do nothing;
  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
  values (v_household, v_user, 'memory_saved', 'memory', v_memory_id);
  update public.operation_requests set record_id = v_memory_id where user_id = v_user and request_id = p_request_id;
  return v_memory_id;
end
$$;

create or replace function public.save_gurtu_item_location(
  p_original_text text,
  p_item_name text,
  p_location text,
  p_person_ids uuid[],
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
  v_memory_id uuid;
  v_item_id uuid;
  v_previous_item uuid;
  v_duplicate_type text;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_request_id is null or length(trim(coalesce(p_original_text, ''))) not between 1 and 8000
     or length(trim(coalesce(p_item_name, ''))) not between 1 and 200
     or length(trim(coalesce(p_location, ''))) not between 1 and 500 then
    raise exception 'invalid location request' using errcode = '22023';
  end if;
  select p.family_id, p.household_id into v_family, v_household from public.profiles p where p.user_id = v_user;
  if v_household is null then raise exception 'family profile required' using errcode = '42501'; end if;
  if exists (
    select 1 from unnest(coalesce(p_person_ids, '{}')) x
    left join public.people p on p.id = x
    where p.id is null or p.family_id <> v_family or not p.is_active
  ) then raise exception 'person is not in this family' using errcode = '42501'; end if;

  insert into public.operation_requests(user_id, request_id, record_type)
  values (v_user, p_request_id, 'item') on conflict do nothing;
  select record_type, record_id into v_duplicate_type, v_previous_item
    from public.operation_requests where user_id = v_user and request_id = p_request_id for update;
  if v_duplicate_type <> 'item' then raise exception 'request ID already used' using errcode = '23505'; end if;
  if v_previous_item is not null then return v_previous_item; end if;

  insert into public.memories(household_id, created_by_user_id, original_text, language, request_id)
  values (v_household, v_user, p_original_text, 'und', p_request_id) returning id into v_memory_id;
  insert into public.items(household_id, canonical_name) values (v_household, trim(p_item_name))
  on conflict (household_id, canonical_name) do update set updated_at = now()
  returning id into v_item_id;
  insert into public.item_people(item_id, person_id)
  select v_item_id, p.id from public.people p where p.id = any(coalesce(p_person_ids, '{}')) and p.family_id = v_family
  on conflict do nothing;
  insert into public.item_location_history(household_id, item_id, location_text, source_memory_id, recorded_by_user_id)
  values (v_household, v_item_id, trim(p_location), v_memory_id, v_user);
  insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id)
  values (v_household, v_user, 'item_location_changed', 'item', v_item_id);
  update public.operation_requests set record_id = v_item_id where user_id = v_user and request_id = p_request_id;
  return v_item_id;
end
$$;

revoke all on function public.create_gurtu_list(text, uuid[], text[], uuid), public.create_gurtu_event(text, text, timestamptz, timestamptz, text, boolean, uuid[], uuid), public.save_gurtu_memory(text, text, text, uuid[], uuid), public.save_gurtu_item_location(text, text, text, uuid[], uuid) from public, anon;
grant execute on function public.create_gurtu_list(text, uuid[], text[], uuid), public.create_gurtu_event(text, text, timestamptz, timestamptz, text, boolean, uuid[], uuid), public.save_gurtu_memory(text, text, text, uuid[], uuid), public.save_gurtu_item_location(text, text, text, uuid[], uuid) to authenticated;
