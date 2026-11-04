begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mom@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dad@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000204', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test', '', now(), now(), now());
insert into public.families(id, name) values ('20000000-0000-4000-8000-000000000201', 'Memory test family');
insert into public.households(id, family_id, name, timezone) values
  ('30000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000201', 'Farm home', 'Asia/Kolkata'),
  ('30000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000201', 'City home', 'America/Toronto');
insert into public.profiles(user_id, family_id, household_id, display_name) values
  ('10000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000201', 'Mom'),
  ('10000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000201', 'Dad'),
  ('10000000-0000-4000-8000-000000000203', '20000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000202', 'Other'),
  ('10000000-0000-4000-8000-000000000204', '20000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000202', 'Admin');
insert into public.people(id, family_id, home_household_id, display_name, aliases) values
  ('40000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000201', 'Ramesh', array['రమేష్']);
insert into private.global_administrators(user_id) values ('10000000-0000-4000-8000-000000000204');

-- Test vectors: unit vectors along different axes.
create temporary table vecs on commit drop as
  select n, '[' || string_agg(case when i = n then '1' else '0' end, ',' order by i) || ']' as v
  from generate_series(1, 3) n, generate_series(1, 1536) i group by n;
grant select on vecs to authenticated;
create temporary table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000201","role":"authenticated"}', true);

-- Mom chats; the reply queues a summary job.
insert into ids select 'mom_message', message_id from public.start_gurtu_message(null, 'f0000000-0000-4000-8000-000000000001', 'వచ్చే వారం రమేష్ కి డబ్బులు ఇవ్వాలి.', 'text', 'te', 'Pay Ramesh');
insert into ids select 'mom_conversation', conversation_id from public.talk_messages where id = (select id from ids where name = 'mom_message');
insert into ids values ('mom_reply', public.record_gurtu_reply((select id from ids where name = 'mom_message'), 'Noted.', null, null, '[]'::jsonb, '{}'::jsonb));
select is((select count(*)::int from public.claim_gurtu_index_jobs(0) where false), 0, 'claiming is available to signed-in users');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000202","role":"authenticated"}', true);
select is((select count(*)::int from public.claim_gurtu_index_jobs(5)), 0, 'another login cannot claim Mom''s indexing jobs');
select throws_ok($$select count(*) from public.memory_index_jobs$$, '42501', 'permission denied for table memory_index_jobs', 'the job queue is not directly readable');
select throws_ok(
  $$insert into public.family_memories(household_id, source_kind, conversation_id, english_text, memory_type) values ('30000000-0000-4000-8000-000000000201', 'conversation', gen_random_uuid(), 'Forged', 'fact')$$,
  '42501', 'permission denied for table family_memories', 'family memories cannot be written directly'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
-- A saved memory queues its own job.
select public.save_gurtu_memory('పాస్‌బుక్ కారులో ఉంది.', 'te', null, '{}', 'f0000000-0000-4000-8000-000000000010');
create temporary table claimed on commit drop as select * from public.claim_gurtu_index_jobs(5);
select is((select count(*)::int from claimed), 2, 'Mom claims her conversation job and her saved-memory job');
select is((select target_message_id from claimed where job_type = 'conversation_turn'), (select id from ids where name = 'mom_reply'), 'the summary job targets the latest reply');
select is((select count(*)::int from public.claim_gurtu_index_jobs(5)), 0, 'a running job is not claimed twice');

select ok(public.index_gurtu_saved_memory((select id from claimed where job_type = 'saved_memory'), 'The passbook is in the car.', (select v from vecs where n = 1), 'test-model') is not null, 'a saved memory is indexed with its English interpretation');
select is((select original_text || ' | ' || english_text from public.family_memories where source_kind = 'saved_memory'), 'పాస్‌బుక్ కారులో ఉంది. | The passbook is in the car.', 'the saved memory keeps the original Telugu and the English interpretation');

select is(public.apply_gurtu_conversation_index(
  (select id from claimed where job_type = 'conversation_turn'), 0, 'Mom said Ramesh must be paid next week.', (select id from ids where name = 'mom_reply'),
  jsonb_build_array(jsonb_build_object(
    'english_text', 'Ramesh needs to be paid next week for tractor work.', 'memory_type', 'plan', 'status', 'current',
    'people_ids', jsonb_build_array('40000000-0000-4000-8000-000000000201', '40000000-0000-4000-8000-000000000999'),
    'source_message_ids', jsonb_build_array((select id from ids where name = 'mom_message'), '50000000-0000-4000-8000-000000000999'),
    'original_language', 'te', 'occurred_on_start', null, 'date_precision', null, 'embedding', (select v from vecs where n = 2))),
  '[]'::jsonb, 'test-model'), true, 'a summary step and its facts are applied together');
select is((select summary_version || ' | ' || summary_en from public.conversations where id = (select id from ids where name = 'mom_conversation')), '1 | Mom said Ramesh must be paid next week.', 'the conversation summary and version advance');
select is((select people_ids from public.family_memories where source_kind = 'conversation'), array['40000000-0000-4000-8000-000000000201']::uuid[], 'only people from this family are tagged');
select is((select source_message_ids from public.family_memories where source_kind = 'conversation'), array[(select id from ids where name = 'mom_message')], 'only messages from this conversation are kept as sources');
select ok((select original_text is null and speaker_name = 'Mom' from public.family_memories where source_kind = 'conversation'), 'a chat fact stores no transcript text, only who shared it');

-- A stale summary write changes nothing and leaves the work queued.
insert into ids select 'mom_message_2', message_id from public.start_gurtu_message((select id from ids where name = 'mom_conversation'), 'f0000000-0000-4000-8000-000000000002', 'మనం రమేష్ కి 5000 ఇచ్చేశాం.', 'text', 'te', 'Paid');
insert into ids values ('mom_reply_2', public.record_gurtu_reply((select id from ids where name = 'mom_message_2'), 'Noted.', null, null, '[]'::jsonb, '{}'::jsonb));
create temporary table claimed2 on commit drop as select * from public.claim_gurtu_index_jobs(5);
select is(public.apply_gurtu_conversation_index((select id from claimed2), 0, 'Stale summary', (select id from ids where name = 'mom_reply_2'), '[]'::jsonb, '[]'::jsonb, null), false, 'an older summary version cannot overwrite a newer one');
select is((select summary_en from public.conversations where id = (select id from ids where name = 'mom_conversation')), 'Mom said Ramesh must be paid next week.', 'the stale write changed nothing');
select is((select count(*)::int from public.claim_gurtu_index_jobs(5)), 1, 'the conflicting job is queued again');

-- Newer information completes the earlier plan; history is kept.
select is(public.apply_gurtu_conversation_index(
  (select id from claimed2), 1, 'Mom said Ramesh must be paid; later she said 5000 was paid.', (select id from ids where name = 'mom_reply_2'),
  jsonb_build_array(jsonb_build_object('english_text', 'The family paid Ramesh 5,000 rupees.', 'memory_type', 'completed_action', 'status', 'completed',
    'people_ids', '[]'::jsonb, 'source_message_ids', jsonb_build_array((select id from ids where name = 'mom_message_2')), 'embedding', (select v from vecs where n = 2))),
  jsonb_build_array(jsonb_build_object('memory_id', (select id from public.family_memories where english_text like 'Ramesh needs%'), 'status', 'completed', 'replaced_by_index', 0)),
  'test-model'), true, 'a later chat step is applied');
select is((select status from public.family_memories where english_text like 'Ramesh needs%'), 'completed', 'the earlier plan is marked completed, not deleted');
select is((select superseded_by from public.family_memories where english_text like 'Ramesh needs%'), (select id from public.family_memories where english_text like 'The family paid%'), 'the earlier plan links to the fact that completed it');

-- Dad, same household, different login: shared recall but not Mom's chat.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000202","role":"authenticated"}', true);
select is((select count(*)::int from public.family_memories), 3, 'household members share recall from each other''s chats');
select is((select count(*)::int from public.talk_messages), 0, 'household members still cannot read the chat itself');
select is((select english_text from public.match_gurtu_family_memories((select v from vecs where n = 2), 'Ramesh paid', 2) limit 1), 'The family paid Ramesh 5,000 rupees.', 'hybrid recall ranks the matching household fact first');
select ok(exists(select 1 from public.match_gurtu_family_memories((select v from vecs where n = 3), 'passbook', 5) where keyword_match and english_text like '%passbook%'), 'a keyword match is found even when the vector is unrelated');
select throws_ok(
  format($$select public.apply_gurtu_conversation_index(%L, 0, 'x', %L, '[]'::jsonb, '[]'::jsonb, null)$$, (select id from claimed2), (select id from ids where name = 'mom_reply_2')),
  '42501', 'index job is not available', 'another login cannot apply Mom''s job'
);

-- Another household and the administrator see none of it.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000203","role":"authenticated"}', true);
select is((select count(*)::int from public.family_memories), 0, 'another household cannot read this household''s recall');
select is((select count(*)::int from public.match_gurtu_family_memories((select v from vecs where n = 2), 'Ramesh', 10)), 0, 'another household''s search returns nothing');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000204","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.family_memories), 0, 'the administrator has no cross-household recall access');
select is((select count(*)::int from public.match_gurtu_family_memories((select v from vecs where n = 2), 'Ramesh', 10)), 0, 'the administrator''s search stays in their own household');

-- Updates cannot reach another household's memory.
reset role;
select ok((select count(*) from public.family_memories where status = 'superseded') = 0, 'no memory was superseded by the stale or foreign attempts');
select is((select count(*)::int from public.memory_index_jobs where job_type = 'saved_memory' and status = 'done'), 1, 'the saved-memory job finished');
delete from public.conversations where id = (select id from ids where name = 'mom_conversation');
select is((select count(*)::int from public.family_memories where source_kind = 'conversation'), 0, 'deleting a chat removes the facts taken from it');
select is((select count(*)::int from public.family_memories where source_kind = 'saved_memory'), 1, 'deleting a chat keeps saved memories');

select * from finish();
rollback;
