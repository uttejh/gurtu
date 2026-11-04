begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'farm1@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000302', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'farm2@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000303', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'city@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000304', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin3@example.test', '', now(), now(), now());
insert into public.families(id, name) values ('20000000-0000-4000-8000-000000000301', 'Vocabulary family'), ('20000000-0000-4000-8000-000000000302', 'Another family');
insert into public.households(id, family_id, name, timezone) values
  ('30000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000301', 'Farm', 'Asia/Kolkata'),
  ('30000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000301', 'City', 'America/Toronto'),
  ('30000000-0000-4000-8000-000000000303', '20000000-0000-4000-8000-000000000302', 'Elsewhere', 'Asia/Kolkata');
insert into public.profiles(user_id, family_id, household_id, display_name) values
  ('10000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000301', 'Farm one'),
  ('10000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000301', 'Farm two'),
  ('10000000-0000-4000-8000-000000000303', '20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000302', 'City'),
  ('10000000-0000-4000-8000-000000000304', '20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000302', 'Admin');
insert into public.people(id, family_id, home_household_id, display_name, aliases) values
  ('40000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000301', 'Dad', array['Nanna']),
  ('40000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000302', '30000000-0000-4000-8000-000000000303', 'Stranger', array[]::text[]);
insert into private.global_administrators(user_id) values ('10000000-0000-4000-8000-000000000304');
create temporary table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000301","role":"authenticated"}', true);

-- Explicit teaching.
insert into ids values ('teach1', public.teach_gurtu_vocabulary('Ramakrishna', array['Ramu'], 'person', 'same', null, 'f0000000-0000-4000-8000-000000000301'));
select is((select status from public.household_vocabulary where alias = 'Ramu'), 'confirmed', 'an explicit statement confirms an alias');
select is(public.teach_gurtu_vocabulary('Ramakrishna', array['Ramu'], 'person', 'same', null, 'f0000000-0000-4000-8000-000000000301'), (select id from ids where name = 'teach1'), 'a retry with the same request ID returns the same entry');
select is((select count(*)::int from public.household_vocabulary), 1, 'a retry does not add a duplicate');
select public.teach_gurtu_vocabulary('Ramesh', array['Ramu', ' ramesh ', 'రమేష్'], 'person', 'same', null, 'f0000000-0000-4000-8000-000000000302');
select is((select status from public.household_vocabulary where canonical_term = 'Ramakrishna'), 'rejected', 'giving an alias a new meaning retires the old meaning');
select is((select string_agg(alias, ',' order by alias) from public.household_vocabulary where canonical_term = 'Ramesh' and status = 'confirmed'), 'Ramu,రమేష్', 'new aliases are confirmed and an alias equal to the term itself is skipped');
select is((select script from public.household_vocabulary where alias = 'రమేష్'), 'telugu', 'the script of an alias is recorded');
select public.teach_gurtu_vocabulary('Nanna', array['Dad'], 'person', 'same', '40000000-0000-4000-8000-000000000301', 'f0000000-0000-4000-8000-000000000303');
select is((select person_id from public.household_vocabulary where alias = 'Dad'), '40000000-0000-4000-8000-000000000301'::uuid, 'a person entry can link to the family directory');
select throws_ok(
  $$select public.teach_gurtu_vocabulary('Someone', array['X'], 'person', 'same', '40000000-0000-4000-8000-000000000302', gen_random_uuid())$$,
  '42501', 'person is not in this family', 'a person from another family cannot be linked'
);
select throws_ok(
  $$select public.teach_gurtu_vocabulary('Cotton', array['Cotton'], 'crop', 'same', null, gen_random_uuid())$$,
  '22023', 'invalid vocabulary', 'teaching nothing new is refused'
);
select throws_ok(
  $$select public.teach_gurtu_vocabulary('Cotton', array['పత్తి'], 'vegetable', 'same', null, gen_random_uuid())$$,
  '22023', 'invalid vocabulary', 'unsupported entity types are refused'
);
select public.teach_gurtu_vocabulary('Suresh', array['Sura'], 'person', 'not_same', null, 'f0000000-0000-4000-8000-000000000304');
select is((select status from public.household_vocabulary where alias = 'Sura'), 'rejected', '"not the same" is recorded as a rejected pair');
select throws_ok(
  $$insert into public.household_vocabulary(household_id, canonical_term, alias, entity_type, status) values ('30000000-0000-4000-8000-000000000301', 'A', 'B', 'crop', 'confirmed')$$,
  '42501', 'permission denied for table household_vocabulary', 'vocabulary cannot be written directly'
);

-- Learning from chat through the indexing job.
insert into ids select 'conv', conversation_id from public.start_gurtu_message(null, 'f0000000-0000-4000-8000-000000000310', 'పత్తి కొన్నాం', 'text', 'te', 'Cotton');
insert into ids select 'm1', id from public.talk_messages where client_message_id = 'f0000000-0000-4000-8000-000000000310';
insert into ids values ('r1', public.record_gurtu_reply((select id from ids where name = 'm1'), 'Noted.', null, null, '[]'::jsonb, '{}'::jsonb));
create temporary table job1 on commit drop as select * from public.claim_gurtu_index_jobs(1);
select public.apply_gurtu_conversation_index((select id from job1), 0, 'They bought cotton.', (select id from ids where name = 'r1'), '[]'::jsonb, '[]'::jsonb, null,
  jsonb_build_array(
    jsonb_build_object('canonical_term', 'cotton', 'alias', 'పత్తి', 'entity_type', 'crop', 'script', 'telugu', 'source_message_id', (select id from ids where name = 'm1')),
    jsonb_build_object('canonical_term', 'Ramesh', 'alias', 'Rameshu', 'entity_type', 'person', 'script', 'latin', 'source_message_id', (select id from ids where name = 'm1')),
    jsonb_build_object('canonical_term', 'Suresh', 'alias', 'Sura', 'entity_type', 'person', 'script', 'latin', 'source_message_id', (select id from ids where name = 'm1')),
    jsonb_build_object('canonical_term', 'Somebody', 'alias', 'Ramu', 'entity_type', 'person', 'script', 'latin', 'source_message_id', (select id from ids where name = 'm1'))));
select is((select status from public.household_vocabulary where alias = 'పత్తి'), 'suggested', 'a first sighting is only a suggestion');
select is((select status from public.household_vocabulary where alias = 'Sura'), 'rejected', 'a rejected pair is never re-suggested');
select is((select count(*)::int from public.household_vocabulary where alias = 'Ramu' and canonical_term = 'Somebody'), 0, 'an alias with a confirmed meaning is not suggested for another');

-- The same message again does not count twice; a second message does.
insert into ids select 'm2', message_id from public.start_gurtu_message((select id from ids where name = 'conv'), 'f0000000-0000-4000-8000-000000000311', 'పత్తి అమ్మాం, Rameshu came', 'text', 'te', 'Cotton');
insert into ids values ('r2', public.record_gurtu_reply((select id from ids where name = 'm2'), 'Noted.', null, null, '[]'::jsonb, '{}'::jsonb));
create temporary table job2 on commit drop as select * from public.claim_gurtu_index_jobs(1);
select public.apply_gurtu_conversation_index((select id from job2), 1, 'They bought and sold cotton.', (select id from ids where name = 'r2'), '[]'::jsonb, '[]'::jsonb, null,
  jsonb_build_array(
    jsonb_build_object('canonical_term', 'cotton', 'alias', 'పత్తి', 'entity_type', 'crop', 'source_message_id', (select id from ids where name = 'm1')),
    jsonb_build_object('canonical_term', 'Ramesh', 'alias', 'Rameshu', 'entity_type', 'person', 'source_message_id', (select id from ids where name = 'm2'))));
select is((select status from public.household_vocabulary where alias = 'పత్తి'), 'suggested', 'seeing the same message again does not confirm a term');
insert into ids select 'm3', message_id from public.start_gurtu_message((select id from ids where name = 'conv'), 'f0000000-0000-4000-8000-000000000312', 'ఇంకా పత్తి ఉంది', 'text', 'te', 'Cotton');
insert into ids values ('r3', public.record_gurtu_reply((select id from ids where name = 'm3'), 'Noted.', null, null, '[]'::jsonb, '{}'::jsonb));
create temporary table job3 on commit drop as select * from public.claim_gurtu_index_jobs(1);
select public.apply_gurtu_conversation_index((select id from job3), 2, 'Cotton again.', (select id from ids where name = 'r3'), '[]'::jsonb, '[]'::jsonb, null,
  jsonb_build_array(jsonb_build_object('canonical_term', 'cotton', 'alias', 'పత్తి', 'entity_type', 'crop', 'source_message_id', (select id from ids where name = 'm3'))));
select is((select status from public.household_vocabulary where alias = 'పత్తి'), 'confirmed', 'a non-person term seen in two different messages is confirmed');
select is((select status from public.household_vocabulary where alias = 'Rameshu'), 'suggested', 'a person name seen twice stays a suggestion until someone states it');
select is((select cardinality(source_message_ids) from public.household_vocabulary where alias = 'పత్తి'), 2, 'each distinct source message is remembered');

-- Captures can carry the new intent and result type.
select public.create_gurtu_capture_request('f0000000-0000-4000-8000-000000000320', 'text', 'Ramu and Ramesh are the same person');
select ok(public.update_gurtu_capture_interpretation('f0000000-0000-4000-8000-000000000320', 'Ramu and Ramesh are the same person', 'Ramu and Ramesh are the same person', 'en', 'teach_vocabulary',
  '{"action":"teach_vocabulary","canonical_term":"Ramesh","aliases":["Ramu"],"entity_type":"person","relation":"same"}'::jsonb, '{}'::uuid[], 'awaiting_confirmation') is not null, 'a teaching capture can be interpreted');
select is(public.finish_gurtu_capture('f0000000-0000-4000-8000-000000000320', 'vocabulary', (select id from ids where name = 'teach1')), true, 'a teaching capture can finish with a vocabulary result');

-- Sharing: the household shares vocabulary; nobody else sees it.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000302","role":"authenticated"}', true);
select ok((select count(*) from public.household_vocabulary where status = 'confirmed') >= 4, 'household members share confirmed vocabulary');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000303","role":"authenticated"}', true);
select is((select count(*)::int from public.household_vocabulary), 0, 'another household in the family cannot read it');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000304","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.household_vocabulary), 0, 'the administrator has no cross-household vocabulary access');
select throws_ok(
  $$select private.suggest_vocabulary('30000000-0000-4000-8000-000000000301', auth.uid(), 'x', 'y', 'crop', null, null, null)$$,
  '42501', null, 'the suggestion helper cannot be called directly'
);

select * from finish();
rollback;
