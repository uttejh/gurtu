create or replace function public.provision_gurtu_family(
  p_family_name text,
  p_households jsonb,
  p_profiles jsonb,
  p_people jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_family_id uuid := gen_random_uuid();
  v_household_ids jsonb := '{}'::jsonb;
  v_entry jsonb;
  v_id uuid;
  v_key text;
  v_timezone text;
  v_family_name text := trim(coalesce(p_family_name, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'trusted provisioning access required' using errcode = '42501';
  end if;
  if length(v_family_name) not between 1 and 120
    or jsonb_typeof(p_households) <> 'array' or jsonb_array_length(p_households) <> 3
    or jsonb_typeof(p_profiles) <> 'array' or jsonb_array_length(p_profiles) <> 5
    or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) <> 6 then
    raise exception 'family setup requires three households, five accounts and six people' using errcode = '22023';
  end if;
  if (select array_agg(value->>'key' order by value->>'key') from jsonb_array_elements(p_households))
      is distinct from array['brother_household', 'my_household', 'parents']::text[] then
    raise exception 'household keys are invalid' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_profiles) where value->>'household_key' = 'parents') <> 1
    or (select count(*) from jsonb_array_elements(p_profiles) where value->>'household_key' = 'my_household') <> 2
    or (select count(*) from jsonb_array_elements(p_profiles) where value->>'household_key' = 'brother_household') <> 2 then
    raise exception 'profile household assignments are invalid' using errcode = '22023';
  end if;
  if (select count(distinct value->>'user_id') from jsonb_array_elements(p_profiles)) <> 5
    or exists (
      select 1 from jsonb_array_elements(p_profiles) p
      left join auth.users u on u.id = (p->>'user_id')::uuid
      where u.id is null or length(trim(coalesce(p->>'display_name', ''))) not between 1 and 120
    ) then
    raise exception 'all five authentication users must exist and have profile names' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_people) where value->>'household_key' = 'parents') <> 2
    or (select count(*) from jsonb_array_elements(p_people) where value->>'household_key' = 'my_household') <> 2
    or (select count(*) from jsonb_array_elements(p_people) where value->>'household_key' = 'brother_household') <> 2
    or exists (select 1 from jsonb_array_elements(p_people) where length(trim(coalesce(value->>'display_name', ''))) not between 1 and 120) then
    raise exception 'each household needs two named family members' using errcode = '22023';
  end if;

  insert into public.families(id, name) values (v_family_id, v_family_name);
  for v_entry in select value from jsonb_array_elements(p_households) loop
    v_key := v_entry->>'key';
    v_timezone := v_entry->>'timezone';
    if length(trim(coalesce(v_entry->>'name', ''))) not between 1 and 120
      or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone)
      or (v_key = 'parents' and v_timezone <> 'Asia/Kolkata') then
      raise exception 'household name or IANA time zone is invalid' using errcode = '22023';
    end if;
    v_id := gen_random_uuid();
    insert into public.households(id, family_id, name, timezone)
      values (v_id, v_family_id, trim(v_entry->>'name'), v_timezone);
    v_household_ids := v_household_ids || jsonb_build_object(v_key, v_id::text);
  end loop;
  for v_entry in select value from jsonb_array_elements(p_profiles) loop
    v_key := v_entry->>'household_key';
    if v_household_ids->>v_key is null then raise exception 'profile household is invalid' using errcode = '22023'; end if;
    insert into public.profiles(user_id, family_id, household_id, display_name)
      values ((v_entry->>'user_id')::uuid, v_family_id, (v_household_ids->>v_key)::uuid, trim(v_entry->>'display_name'));
  end loop;
  select (p.value->>'user_id')::uuid into v_id
    from jsonb_array_elements(p_profiles) p
    join auth.users u on u.id = (p.value->>'user_id')::uuid
    where lower(u.email) = 'chinna@gurtu.com' and p.value->>'household_key' = 'my_household';
  if v_id is null then raise exception 'Chinna must be provisioned in Household 2 to receive the administrator role' using errcode = '22023'; end if;
  insert into private.global_administrators(user_id) values (v_id);
  for v_entry in select value from jsonb_array_elements(p_people) loop
    v_key := v_entry->>'household_key';
    if v_household_ids->>v_key is null then raise exception 'person household is invalid' using errcode = '22023'; end if;
    insert into public.people(family_id, home_household_id, display_name, aliases)
      values (
        v_family_id,
        (v_household_ids->>v_key)::uuid,
        trim(v_entry->>'display_name'),
        coalesce(array(select trim(alias_text) from jsonb_array_elements_text(coalesce(v_entry->'aliases', '[]'::jsonb)) as aliases(alias_text) where length(trim(alias_text)) > 0), '{}')
      );
  end loop;
  return jsonb_build_object('family_id', v_family_id, 'household_ids', v_household_ids, 'profile_count', 5, 'person_count', 6, 'global_admin_user_id', v_id);
end
$$;

revoke all on function public.provision_gurtu_family(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.provision_gurtu_family(text, jsonb, jsonb, jsonb) to service_role;
