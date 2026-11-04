begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'three@example.test', '', now(), now(), now());
insert into public.families(id, name) values ('20000000-0000-4000-8000-000000000101', 'Conversation test family');
insert into public.households(id, family_id, name, timezone) values
  ('30000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', 'Shared home', 'America/Toronto'),
  ('30000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000101', 'Other home', 'Asia/Kolkata');
insert into public.profiles(user_id, family_id, household_id, display_name) values
  ('10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', 'One'),
  ('10000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000101', 'Two'),
  ('10000000-0000-4000-8000-000000000103', '20000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000102', 'Three');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

create temporary table first_start on commit drop as
  select * from public.start_gurtu_message(null, 'e0000000-0000-4000-8000-000000000001', 'What is on this week?', 'text', 'en', 'What is on this week?');
grant select on first_start to authenticated;
select is((select created from first_start), true, 'a first message creates a conversation and saves the words');
select is((select title from public.conversations where id = (select conversation_id from first_start)), 'What is on this week?', 'the new conversation gets the generated title');
select is(
  (select message_id from public.start_gurtu_message(null, 'e0000000-0000-4000-8000-000000000001', 'What is on this week?', 'text', 'en', 'What is on this week?')),
  (select message_id from first_start),
  'retrying the same client message ID returns the original message'
);
select is((select count(*)::int from public.talk_messages where client_message_id = 'e0000000-0000-4000-8000-000000000001'), 1, 'a retry does not save the words twice');
select is((select count(*)::int from public.conversations), 1, 'a retry does not create a second conversation');
select throws_ok(
  $$select * from public.start_gurtu_message(gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001', 'What is on this week?', 'text', 'en', 'Title')$$,
  '23505', 'message ID already used', 'a client message ID cannot be reused in another conversation'
);
select throws_ok(
  $$select * from public.start_gurtu_message(null, gen_random_uuid(), '   ', 'text', 'en', 'Title')$$,
  '22023', 'invalid message', 'an empty message is refused'
);
select throws_ok(
  $$select * from public.start_gurtu_message(null, gen_random_uuid(), repeat('a', 8001), 'text', 'en', 'Title')$$,
  '22023', 'invalid message', 'an overlong message is refused'
);

create temporary table first_reply on commit drop as
  select public.record_gurtu_reply((select message_id from first_start), 'Nothing is planned this week.', 'answer', null, '[]'::jsonb, '{"kind":"answer"}'::jsonb) as id;
grant select on first_reply to authenticated;
select is(
  public.record_gurtu_reply((select message_id from first_start), 'A different second answer.', 'answer', null, '[]'::jsonb, '{}'::jsonb),
  (select id from first_reply),
  'recording a reply again returns the reply already saved'
);
select is((select count(*)::int from public.talk_messages where role = 'assistant'), 1, 'one message gets exactly one assistant reply');
select is((select reply_to_message_id from public.talk_messages where id = (select id from first_reply)), (select message_id from first_start), 'the reply is linked to the message it answers');
select ok(
  (select m.created_at >= u.created_at from public.talk_messages m, public.talk_messages u where m.id = (select id from first_reply) and u.id = (select message_id from first_start)),
  'the reply is ordered after the message it answers'
);

select public.start_gurtu_message(null, 'e0000000-0000-4000-8000-000000000002', 'Second chat', 'text', 'en', 'Second chat');
select is((select count(*)::int from public.conversations), 2, 'a new chat is a separate conversation');
select is((select title from public.conversations order by last_activity_at desc limit 1), 'Second chat', 'conversations sort by most recent activity');

-- Older app versions insert directly without a conversation.
insert into public.talk_messages(user_id, role, content, created_at)
  values ('10000000-0000-4000-8000-000000000101', 'user', 'Legacy client message', now() - interval '30 days');
select is(
  (select c.title from public.talk_messages m join public.conversations c on c.id = m.conversation_id where m.content = 'Legacy client message'),
  'Second chat', 'a legacy insert joins the most recent conversation'
);
select ok(
  (select created_at > now() - interval '1 minute' from public.talk_messages where content = 'Legacy client message'),
  'the server sets the receipt time, not the client'
);
select throws_ok(
  $$update public.conversations set title = 'Changed'$$,
  '42501', 'permission denied for table conversations', 'conversations cannot be edited directly'
);

-- Another login in the same household.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
select is((select count(*)::int from public.conversations), 0, 'a household member cannot list another login''s conversations');
select is((select count(*)::int from public.talk_messages), 0, 'a household member cannot read another login''s messages');
select throws_ok(
  format($$select * from public.start_gurtu_message(%L, gen_random_uuid(), 'Intrusion', 'text', 'en', 'Title')$$, (select conversation_id from first_start)),
  '42501', 'conversation is not available', 'a household member cannot post into another login''s conversation'
);
select throws_ok(
  format($$select public.record_gurtu_reply(%L, 'Fake reply', null, null, '[]'::jsonb, '{}'::jsonb)$$, (select message_id from first_start)),
  '42501', 'message is not available', 'a household member cannot add a reply to another login''s message'
);
select throws_ok(
  format($$insert into public.talk_messages(user_id, conversation_id, role, content) values (auth.uid(), %L, 'user', 'Intrusion')$$, (select conversation_id from first_start)),
  '42501', 'conversation is not available', 'a direct insert cannot target another login''s conversation'
);
select is(
  (select created from public.start_gurtu_message(null, 'e0000000-0000-4000-8000-000000000001', 'Same ID, different login', 'text', 'en', 'Mine')),
  true, 'client message IDs are scoped to each login'
);

-- A removal waiting for confirmation can be cancelled ("Keep it").
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000103', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000103","role":"authenticated"}', true);
select public.create_gurtu_capture_request('e0000000-0000-4000-8000-000000000010', 'text', 'Remove rice from groceries');
select public.update_gurtu_capture_interpretation(
  'e0000000-0000-4000-8000-000000000010', 'Remove rice from groceries', 'Remove rice from groceries', 'en', 'remove_list_item',
  '{"action":"remove_list_item","list_title":"Groceries","item_text":"rice","people_mentions":[]}'::jsonb, '{}'::uuid[], 'awaiting_confirmation'
);
select is(public.cancel_gurtu_capture('e0000000-0000-4000-8000-000000000010'), true, 'a pending removal can be cancelled');
select is((select processing_status from public.get_own_capture_requests() where request_id = 'e0000000-0000-4000-8000-000000000010'), 'cancelled', 'the cancelled removal is recorded');
select is(public.confirm_gurtu_capture_operation('e0000000-0000-4000-8000-000000000010', 'Remove rice from groceries', '{}'::uuid[]), false, 'a cancelled removal can no longer be confirmed');
select is(public.cancel_gurtu_capture('e0000000-0000-4000-8000-000000000011'), false, 'cancelling an unknown request changes nothing');

select * from finish();
rollback;
