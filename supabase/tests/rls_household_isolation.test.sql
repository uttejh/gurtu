begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'parents@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chinna@gurtu.com', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ash@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nani@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sush@example.test', '', now(), now(), now());

insert into public.families(id, name) values ('20000000-0000-4000-8000-000000000001', 'Gurtu test family');
insert into public.households(id, family_id, name, timezone) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Parents', 'Asia/Kolkata'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'My household', 'America/Toronto'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Brother household', 'America/Chicago');
insert into public.profiles(user_id, family_id, household_id, display_name) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Parents'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Chinna'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Ash'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Nani'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Sush');
insert into public.people(id, family_id, home_household_id, display_name, aliases) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Mom', array['Amma', 'అమ్మ']),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Dad', array['Nanna', 'నాన్న']),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Chinna', array[]::text[]),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Ash', array[]::text[]),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Nani', array[]::text[]),
  ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Sush', array[]::text[]);

insert into public.memories(id, household_id, created_by_user_id, original_text, request_id) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Parents private memory', '60000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'My household private memory', '60000000-0000-4000-8000-000000000002'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'Brother private memory', '60000000-0000-4000-8000-000000000003');
insert into public.memories(id, household_id, created_by_user_id, original_text, language, request_id) values
  ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'నా పాస్‌బుక్ కారులో పెట్టాను.', 'te', '60000000-0000-4000-8000-000000000014');
insert into public.memory_people(memory_id, person_id) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003');
insert into public.items(id, household_id, canonical_name) values
  ('c0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Passbook');
insert into public.item_location_history(id, household_id, item_id, location_text, source_memory_id, recorded_by_user_id) values
  ('c0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'car', '50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');
insert into public.lists(id, owner_household_id, title, created_by_user_id, request_id) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Shared list', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004'),
  ('70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'Nani private list', '10000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000008');
insert into public.list_household_access(list_id, household_id, granted_by_user_id) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
insert into public.list_items(id, list_id, item_text, created_by_user_id, request_id, position) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Rice', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000005', 1);
insert into public.list_people(list_id, person_id) values
  ('70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');
insert into public.events(id, owner_household_id, title, starts_at, ends_at, timezone, created_by_user_id, request_id) values
  ('90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Shared appointment', now() + interval '1 day', now() + interval '1 day 1 hour', 'Asia/Kolkata', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000006'),
  ('90000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Private parents event', now() + interval '2 days', now() + interval '2 days 1 hour', 'Asia/Kolkata', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000007');
insert into public.event_household_access(event_id, household_id, granted_by_user_id) values
  ('90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
insert into public.event_people(event_id, person_id) values
  ('90000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002');
insert into public.item_people(item_id, person_id) values
  ('c0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002');
insert into public.activity_log(household_id, actor_user_id, action, record_type, record_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'memory_saved', 'memory', '50000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'memory_saved', 'memory', '50000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'memory_saved', 'memory', '50000000-0000-4000-8000-000000000003');
insert into private.global_administrators(user_id) values ('10000000-0000-4000-8000-000000000002');
insert into public.capture_requests(id, family_id, household_id, submitted_by_user_id, request_id, input_type, original_transcript, corrected_transcript, detected_language, detected_intent, extracted_payload, processing_status) values
  ('a0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000011', 'voice', 'Remember this for Mum.', 'Remember this for Mom.', 'en', 'save_memory', '{"action":"save_memory","summary":"A family memory","people_mentions":["Mom"]}', 'succeeded'),
  ('a0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000012', 'text', 'Create a shopping list with rice, sugar and oil.', 'Create a shopping list with rice, sugar and oil.', 'en', 'create_list', '{"action":"create_list","title":"Family groceries","items":["Rice","Sugar","Oil"],"people_mentions":[]}', 'operation_failed'),
  ('a0000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000013', 'text', 'Nani saved a memory.', 'Nani saved a memory.', 'en', 'save_memory', '{"action":"save_memory"}', 'succeeded'),
  ('a0000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000014', 'voice', 'నా పాస్‌బుక్ కారులో పెట్టాను.', 'నా పాస్‌బుక్ కారులో పెట్టాను.', 'te', 'save_item_location', '{"action":"save_item_location","item_name":"Passbook","location":"car","people_mentions":["Dad"]}', 'succeeded');
update public.capture_requests set result_entity_type = 'memory', result_entity_id = '50000000-0000-4000-8000-000000000001', selected_person_ids = array['40000000-0000-4000-8000-000000000003']::uuid[] where id = 'a0000000-0000-4000-8000-000000000001';
update public.capture_requests set result_entity_type = 'item', result_entity_id = 'c0000000-0000-4000-8000-000000000001', selected_person_ids = array['40000000-0000-4000-8000-000000000002']::uuid[] where id = 'a0000000-0000-4000-8000-000000000004';
insert into public.admin_audit_log(id, family_id, admin_user_id, action, target_capture_request_id)
values ('b0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'capture_viewed', 'a0000000-0000-4000-8000-000000000001');

select is((select count(*)::int from public.profiles p join auth.users u on u.id = p.user_id), 5, 'five distinct authentication identities have family profiles');
select is((select count(*)::int from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'Parents'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'Chinna'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'Ash'),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'Nani'),
  ('10000000-0000-4000-8000-000000000005'::uuid, 'Sush')
) expected(user_id, display_name) join public.profiles p using (user_id) where p.display_name = expected.display_name), 5, 'all five authentication identities retain the correct profile identity');
select is((select count(*)::int from private.global_administrators), 1, 'only one provisioned global administrator identity exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.memories), 2, 'parents account reads only parents household memories');
select is((select count(*)::int from public.people), 6, 'family members can read names and aliases across households');
select ok(not has_table_privilege('authenticated', 'auth.users', 'select'), 'authenticated family users cannot read auth users or password hashes');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and column_name ~* '(password|api_key|secret)'), 0, 'application tables do not expose passwords or infrastructure secrets');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'capture_requests' and column_name ~* 'audio'), 0, 'capture history has no audio payload or file column');
select throws_ok(
  $$select public.change_gurtu_list_item(null, '70000000-0000-4000-8000-000000000001')$$,
  '22023', 'invalid list change', 'list mutation rejects a null action'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
select ok(public.has_gurtu_global_admin_role(), 'Chinna has the provisioned global administrator identity');
select is((select count(*)::int from public.profiles), 1, 'administrator role alone does not bypass RLS before MFA');
select is((select count(*)::int from public.memories), 1, 'administrator sees only the normal household at AAL1');
select is((select count(*)::int from public.items), 0, 'administrator cannot read other household locations before MFA');
select is((select count(*)::int from public.activity_log), 1, 'administrator sees only Household 2 activity before MFA');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.memories), 4, 'administrator at AAL2 reads all three household memories');
select is((select count(*)::int from public.profiles), 5, 'administrator at AAL2 reads all five separate identities');
select is((select count(*)::int from public.lists), 2, 'administrator at AAL2 reads private and shared household lists');
select is((select count(*)::int from public.events), 2, 'administrator at AAL2 reads all calendar events');
select is((select count(*)::int from public.items), 1, 'administrator at AAL2 reads household items');
select is((select count(*)::int from public.item_location_history), 1, 'administrator at AAL2 reads all item location history');
select is((select count(*)::int from public.memory_people), 1, 'administrator at AAL2 reads memory person associations');
select is((select count(*)::int from public.item_people), 1, 'administrator at AAL2 reads item person associations');
select is((select count(*)::int from public.list_items), 1, 'administrator at AAL2 reads household list items');
select is((select count(*)::int from public.list_people), 1, 'administrator at AAL2 reads list person associations');
select is((select count(*)::int from public.list_household_access), 1, 'administrator at AAL2 reads list sharing relationships');
select is((select count(*)::int from public.event_people), 1, 'administrator at AAL2 reads event person associations');
select is((select count(*)::int from public.event_household_access), 1, 'administrator at AAL2 reads event sharing relationships');
select is((select count(*)::int from public.activity_log), 3, 'administrator at AAL2 reviews activity across all households');
select is((select count(*)::int from public.capture_requests), 4, 'administrator at AAL2 reviews captures from all households');
select is((select count(*)::int from public.admin_audit_log), 1, 'administrator at AAL2 can review the admin audit trail');
select is((select count(*)::int from public.capture_requests where id = 'a0000000-0000-4000-8000-000000000002' and processing_status = 'operation_failed' and original_transcript = 'Create a shopping list with rice, sugar and oil.'), 1, 'a failed operation remains available with its original transcript');
select is((select original_transcript || ' / ' || corrected_transcript from public.capture_requests where id = 'a0000000-0000-4000-8000-000000000001'), 'Remember this for Mum. / Remember this for Mom.', 'the original and corrected transcripts remain distinct');
select throws_ok(
  $$select * from private.global_administrators$$,
  '42501', 'permission denied for table global_administrators', 'administrator role storage is not directly readable'
);
select throws_ok(
  $$insert into private.global_administrators(user_id) values (auth.uid())$$,
  '42501', 'permission denied for table global_administrators', 'authenticated users cannot assign an administrator role'
);
select is(public.admin_retry_gurtu_capture('a0000000-0000-4000-8000-000000000002')->>'ok', 'true', 'administrator can safely retry a failed shopping list');
select is((select count(*)::int from public.lists where title = 'Family groceries'), 1, 'the retry creates one list with the requested items');
select throws_ok(
  $$select public.admin_retry_gurtu_capture('a0000000-0000-4000-8000-000000000002')$$,
  '22023', 'successful operations cannot be retried', 'a successful retry cannot run a second time'
);
select is((select count(*)::int from public.lists where title = 'Family groceries'), 1, 'a repeated retry does not create a duplicate list');
select ok(public.admin_correct_capture_people('a0000000-0000-4000-8000-000000000001', array['40000000-0000-4000-8000-000000000001']::uuid[], 'The transcript says Mom.'), 'administrator can correct a person association');
select is((select count(*)::int from public.memory_people where memory_id = '50000000-0000-4000-8000-000000000001' and person_id = '40000000-0000-4000-8000-000000000001'), 1, 'corrected people tags are reflected on the saved memory');
select is((select count(*)::int from public.admin_audit_log where action = 'people_corrected' and previous_value = '["40000000-0000-4000-8000-000000000003"]'::jsonb and new_value = '["40000000-0000-4000-8000-000000000001"]'::jsonb), 1, 'people corrections preserve the previous and new tags in the audit trail');
select ok(public.admin_correct_capture_location('a0000000-0000-4000-8000-000000000004', 'blue bag', 'The family confirmed the correct location.'), 'administrator can correct a structured location');
select is((select count(*)::int from public.item_location_history where item_id = 'c0000000-0000-4000-8000-000000000001'), 2, 'location correction appends a new history entry instead of overwriting the original');
select is((select count(*)::int from public.admin_audit_log where action = 'location_corrected' and previous_value->>'location' = 'car' and new_value->>'location' = 'blue bag'), 1, 'location corrections record previous and updated values');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}', true);
select ok(not public.has_gurtu_global_admin_role(), 'Ash does not receive the administrator role');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.memories), 1, 'second account in a household shares that household memory view');
select is((select count(*)::int from public.lists), 2, 'recipient sees its own list and the one explicitly shared list');
select is((select count(*)::int from public.list_items), 4, 'recipient sees items in its own list and the explicitly shared list');
select is((select count(*)::int from public.capture_requests), 0, 'Ash cannot read another account capture from the same household');
select is((select count(*)::int from public.admin_audit_log), 0, 'Ash cannot read administrative audit records');
select is((select count(*)::int from public.item_location_history), 0, 'Ash cannot read parents household location history');
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
select is((select count(*)::int from public.memories), 1, 'Nani account cannot read parents or Chinna household memories');
select is((select count(*)::int from public.events), 0, 'Nani household cannot see an event shared only with Chinna household');
select ok(not public.has_gurtu_global_admin_role(), 'Nani does not receive the administrator role');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
select ok(not public.has_gurtu_global_admin_role(), 'Sush does not receive the administrator role');
select is((select count(*)::int from public.memories), 1, 'Sush can read the shared Nani and Sush household memory');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.events), 1, 'Chinna household sees the event explicitly shared with it');
select is((select title from public.events where id = '90000000-0000-4000-8000-000000000001'), 'Shared appointment', 'event row remains readable through explicit event access');
select is((select count(*)::int from public.memories), 1, 'shared event access does not expose the parents household memories');
select is((select count(*)::int from public.lists), 2, 'the explicitly shared list remains separate from other household data');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.create_gurtu_capture_request('60000000-0000-4000-8000-000000000020', 'text', 'Remember this for Dad.');
select is((select processing_status || '|' || original_transcript || '|' || corrected_transcript from public.capture_requests where request_id = '60000000-0000-4000-8000-000000000020'), 'received|Remember this for Dad.|Remember this for Dad.', 'typed text is recorded before AI processing');
select throws_ok(
  $$select public.update_gurtu_capture_interpretation('60000000-0000-4000-8000-000000000020', 'Changed source text', 'Remember this for Dad.', 'en', 'save_memory', '{"action":"save_memory","summary":"A note","people_mentions":["Dad"]}'::jsonb, array['40000000-0000-4000-8000-000000000002']::uuid[], 'awaiting_confirmation')$$,
  '42501', 'capture request is not available', 'a caller cannot overwrite the original received transcript'
);
select public.update_gurtu_capture_interpretation(
  '60000000-0000-4000-8000-000000000020', 'Remember this for Dad.', 'Remember this for Dad.', 'en', 'save_memory',
  '{"action":"save_memory","summary":"A note","people_mentions":["Dad"]}'::jsonb,
  array['40000000-0000-4000-8000-000000000002']::uuid[], 'awaiting_confirmation'
);
select is((select detected_intent || '|' || processing_status || '|' || (selected_person_ids = array['40000000-0000-4000-8000-000000000002']::uuid[])::text from public.capture_requests where request_id = '60000000-0000-4000-8000-000000000020'), 'save_memory|awaiting_confirmation|true', 'validated interpretation and suggested person tags are stored');
select is(public.confirm_gurtu_capture_operation('60000000-0000-4000-8000-000000000020', 'Remember this for Dad.', array['40000000-0000-4000-8000-000000000002']::uuid[]), true, 'confirmation advances the capture before a database write');
select public.save_gurtu_memory('Remember this for Dad.', 'en', 'A note', array['40000000-0000-4000-8000-000000000002']::uuid[], '60000000-0000-4000-8000-000000000020');
select is(public.finish_gurtu_capture('60000000-0000-4000-8000-000000000020', 'memory', (select id from public.memories where request_id = '60000000-0000-4000-8000-000000000020')), true, 'successful database writes finish their capture with a result');
select is((select processing_status || '|' || result_entity_type from public.capture_requests where request_id = '60000000-0000-4000-8000-000000000020'), 'succeeded|memory', 'capture stores the completed result type');
select public.create_gurtu_capture_request('60000000-0000-4000-8000-000000000021', 'text', 'Remember an unavailable note.');
select is(public.fail_gurtu_capture('60000000-0000-4000-8000-000000000021', 'interpretation_failed', 'INTERPRETATION_FAILED', 'Gurtu could not prepare a safe interpretation.'), true, 'interpretation failure stays attached to its capture');
select is((select processing_status || '|' || error_code from public.capture_requests where request_id = '60000000-0000-4000-8000-000000000021'), 'interpretation_failed|INTERPRETATION_FAILED', 'failed captures preserve a safe status and error code');

select * from finish();
rollback;
