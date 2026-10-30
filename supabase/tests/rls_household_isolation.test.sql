begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mom@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'me@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wife@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brother@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sister-in-law@example.test', '', now(), now(), now());

insert into public.families(id, name) values ('20000000-0000-4000-8000-000000000001', 'Gurtu test family');
insert into public.households(id, family_id, name, timezone) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Parents', 'Asia/Kolkata'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'My household', 'America/Toronto'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Brother household', 'America/Chicago');
insert into public.profiles(user_id, family_id, household_id, display_name) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Parents'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Me'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Wife'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Brother'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Sister in law');
insert into public.people(id, family_id, home_household_id, display_name, aliases) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Mom', array['Amma', 'అమ్మ']),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Dad', array['Nanna', 'నాన్న']),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Me', array[]::text[]),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Wife', array[]::text[]),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Brother', array[]::text[]),
  ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Sister in law', array[]::text[]);

insert into public.memories(id, household_id, created_by_user_id, original_text, request_id) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Parents private memory', '60000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'My household private memory', '60000000-0000-4000-8000-000000000002'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'Brother private memory', '60000000-0000-4000-8000-000000000003');
insert into public.lists(id, owner_household_id, title, created_by_user_id, request_id) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Shared list', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004');
insert into public.list_household_access(list_id, household_id, granted_by_user_id) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
insert into public.list_items(id, list_id, item_text, created_by_user_id, request_id, position) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Rice', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000005', 1);
insert into public.events(id, owner_household_id, title, starts_at, ends_at, timezone, created_by_user_id, request_id) values
  ('90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Shared appointment', now() + interval '1 day', now() + interval '1 day 1 hour', 'Asia/Kolkata', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000006'),
  ('90000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Private parents event', now() + interval '2 days', now() + interval '2 days 1 hour', 'Asia/Kolkata', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000007');
insert into public.event_household_access(event_id, household_id, granted_by_user_id) values
  ('90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.memories), 1, 'parents account reads only parents household memories');
select is((select count(*)::int from public.people), 6, 'family members can read names and aliases across households');
select throws_ok(
  $$select public.change_gurtu_list_item(null, '70000000-0000-4000-8000-000000000001')$$,
  '22023', 'invalid list change', 'list mutation rejects a null action'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.memories), 1, 'second account in a household shares that household memory view');
select is((select count(*)::int from public.lists), 1, 'explicitly shared list is visible to recipient household');
select is((select count(*)::int from public.list_items), 1, 'recipient household can use the explicitly shared list');
select throws_ok(
  $$update public.memories set household_id = '30000000-0000-4000-8000-000000000003' where id = '50000000-0000-4000-8000-000000000002'$$,
  '42501', 'permission denied for table memories', 'memory owner cannot change household to gain access'
);
select throws_ok(
  $$update public.profiles set household_id = '30000000-0000-4000-8000-000000000003' where user_id = auth.uid()$$,
  '42501', 'permission denied for table profiles', 'authenticated users cannot change their own household profile'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.memories), 1, 'brother account cannot read parents or my household memories');
select is((select count(*)::int from public.events), 0, 'brother household cannot see an event shared only with my household');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.events), 1, 'my household sees the event explicitly shared with it');
select is((select title from public.events where id = '90000000-0000-4000-8000-000000000001'), 'Shared appointment', 'event row remains readable through explicit event access');
select is((select count(*)::int from public.memories), 1, 'shared event access does not expose the event owner household memories');
select is((select count(*)::int from public.lists), 1, 'the explicitly shared list is separate from other household data');

select * from finish();
rollback;
