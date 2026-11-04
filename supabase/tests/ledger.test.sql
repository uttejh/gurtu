begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ledger1@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ledger2@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ledger3@example.test', '', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000404', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ledgeradmin@example.test', '', now(), now(), now());
insert into public.families(id, name) values ('20000000-0000-4000-8000-000000000401', 'Ledger family');
insert into public.households(id, family_id, name, timezone) values
  ('30000000-0000-4000-8000-000000000401', '20000000-0000-4000-8000-000000000401', 'Farm', 'Asia/Kolkata'),
  ('30000000-0000-4000-8000-000000000402', '20000000-0000-4000-8000-000000000401', 'City', 'America/Toronto');
insert into public.profiles(user_id, family_id, household_id, display_name) values
  ('10000000-0000-4000-8000-000000000401', '20000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000401', 'Dad'),
  ('10000000-0000-4000-8000-000000000402', '20000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000401', 'Mom'),
  ('10000000-0000-4000-8000-000000000403', '20000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000402', 'City'),
  ('10000000-0000-4000-8000-000000000404', '20000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000402', 'Admin');
insert into private.global_administrators(user_id) values ('10000000-0000-4000-8000-000000000404');
create temporary table r (name text primary key, result jsonb) on commit drop;
grant select, insert on r to authenticated;
create function pg_temp.op_id(p_name text, p_index integer) returns uuid language sql as
  $$ select ((select result from r where name = p_name)->'operations'->p_index->>'id')::uuid $$;
create function pg_temp.report(p_from date default null, p_to date default null) returns jsonb language sql as
  $$ select public.get_gurtu_ledger_report(p_from, p_to, null) $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000401","role":"authenticated"}', true);

-- Planned purchase: one task with a due date, no money.
insert into r values ('plan', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000401', null, 'Tomorrow we need to buy cotton seeds.',
  '[{"op":"create_task","ref":"t","item_text":"Buy cotton seeds","due_on":"2026-11-06"}]'));
select is((select due_on from public.list_items where id = pg_temp.op_id('plan', 0)), '2026-11-06'::date, 'a planned purchase becomes one task with its due date');
select is((select l.title from public.lists l join public.list_items i on i.list_id = l.id where i.id = pg_temp.op_id('plan', 0)), 'Tasks', 'tasks go to a Tasks list by default');
select is((select count(*)::int from public.ledger_entries), 0, 'planning a purchase records no money');

-- Purchase completed: one expense, linked, task done.
insert into r values ('bought', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000402', null, 'Today we bought cotton seeds for 12,000.',
  format('[{"op":"ledger_entry","nature":"operating_expense","status":"actual","amount_paise":1200000,"description_en":"Cotton seeds","category_name":"Seeds","occurred_on_start":"2026-11-05","list_item_id":"%s"},{"op":"complete_task","list_item_id":"%s"}]', pg_temp.op_id('plan', 0), pg_temp.op_id('plan', 0))::jsonb));
select is((select related_list_item_id from public.ledger_entries where id = pg_temp.op_id('bought', 0)), pg_temp.op_id('plan', 0), 'the expense links to the task');
select ok((select is_completed and completed_at is not null from public.list_items where id = pg_temp.op_id('plan', 0)), 'the task is marked done with a completion time');
select is(public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000402', null, 'x', '[{"op":"ledger_entry","nature":"income","amount_paise":1,"description_en":"other"}]'),
  (select result from r where name = 'bought'), 'retrying a request returns the first result');
select is((select count(*)::int from public.ledger_entries), 1, 'a retry records nothing twice');

-- Atomic: one bad operation undoes the whole plan.
select throws_ok(
  $$select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000403', null, 'x', '[{"op":"ledger_entry","nature":"operating_expense","amount_paise":50000,"description_en":"Diesel"},{"op":"launch_rocket"}]')$$,
  '22023', 'unsupported plan operation', 'an invalid operation is refused'
);
select is((select count(*)::int from public.ledger_entries where description_en = 'Diesel'), 0, 'nothing from a refused plan is saved');

-- Cash handover with allocations and returned cash.
insert into r values ('handover', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000404', null, 'Ramesh ki 10,000 ichanu...', '[
  {"op":"ledger_entry","ref":"h","nature":"cash_handover","amount_paise":1000000,"description_en":"Cash given to Ramesh","party_name":"Ramesh","party_kind":"worker","occurred_on_start":"2026-11-05"},
  {"op":"allocation","handover_ref":"h","amount_paise":200000,"description_en":"Seeds","category_name":"Seeds","kind":"farm_purchase"},
  {"op":"allocation","handover_ref":"h","amount_paise":150000,"description_en":"Diesel","category_name":"Fuel","kind":"farm_purchase"},
  {"op":"allocation","handover_ref":"h","amount_paise":50000,"description_en":"Kept for personal use","kind":"personal"},
  {"op":"ledger_entry","nature":"cash_returned","handover_ref":"h","amount_paise":600000,"description_en":"Ramesh returned cash","party_name":"Ramesh","occurred_on_start":"2026-11-05"}]'));
select is((select kind from public.ledger_parties where name = 'Ramesh'), 'worker', 'the person handed money gets a worker account');
select throws_ok(
  format($$select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000405', null, 'x', '[{"op":"allocation","handover_entry_id":"%s","amount_paise":1,"description_en":"Tea","kind":"other"}]')$$, pg_temp.op_id('handover', 0)),
  '22023', 'settlement exceeds handover', 'allocations and returns can never exceed the handover'
);
select is((pg_temp.report()->>'cash_out_paise')::bigint, 2200000::bigint, 'cash out counts the expense and the handover once, not the allocations');
select is((pg_temp.report()->>'cash_in_paise')::bigint, 600000::bigint, 'returned cash is money in');
select is((pg_temp.report()->>'handover_purchases_paise')::bigint, 350000::bigint, 'purchases made from the handover are classified, not double-counted');
select is((pg_temp.report()->>'personal_payments_paise')::bigint, 50000::bigint, 'the amount kept for personal use is a personal payment');
select is((pg_temp.report()->>'settled_handovers')::int, 1, 'allocations plus returns equal to the handover mark it settled');
select is(jsonb_array_length(pg_temp.report()->'open_handovers'), 0, 'a settled handover is not outstanding');
select is((select sum((value->>'paise')::bigint) from jsonb_array_elements(pg_temp.report()->'by_category') where value->>'name' = 'Seeds'), 1400000::numeric, 'seed spending combines the direct purchase and the handover purchase');

-- Partial handover stays outstanding.
insert into r values ('partial', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000406', null, 'Gave Suresh 5000, he bought 2000 fertiliser.', '[
  {"op":"ledger_entry","ref":"h","nature":"cash_handover","amount_paise":500000,"description_en":"Cash given to Suresh","party_name":"Suresh","occurred_on_start":"2026-11-05"},
  {"op":"allocation","handover_ref":"h","amount_paise":200000,"description_en":"Fertiliser","category_name":"Fertiliser","kind":"farm_purchase"}]'));
select is((pg_temp.report()->'open_handovers'->0->>'remaining_paise')::bigint, 300000::bigint, 'a partly settled handover shows the remaining amount');
select is(pg_temp.report()->'open_handovers'->0->>'status', 'partially_settled', 'and is marked partially settled');

-- Loans, principal and interest are kept apart from income and expenses.
select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000407', null, 'Bank loan, repayment and interest', '[
  {"op":"ledger_entry","nature":"loan_received","amount_paise":5000000,"description_en":"Crop loan","party_name":"SBI","party_kind":"bank","occurred_on_start":"2026-11-02"},
  {"op":"ledger_entry","nature":"loan_principal_repayment","amount_paise":1000000,"description_en":"Loan principal","party_name":"SBI","occurred_on_start":"2026-11-03"},
  {"op":"ledger_entry","nature":"interest_payment","amount_paise":120000,"description_en":"Loan interest","party_name":"SBI","category_name":"Interest","occurred_on_start":"2026-11-03"},
  {"op":"ledger_entry","nature":"income","amount_paise":8500000,"description_en":"Cotton sold","category_name":"Cotton sales","occurred_on_start":"2026-11-04"}]');
select is((pg_temp.report()->>'income_paise')::bigint, 8500000::bigint, 'a loan is not counted as income');
select is((pg_temp.report()->>'operating_expense_paise')::bigint, 1200000::bigint, 'principal repayment is not an operating expense');
select is((pg_temp.report()->>'interest_paise')::bigint, 120000::bigint, 'interest is its own line');

-- Planned payments and estimates never count until paid.
insert into r values ('lease', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000408', null, 'Land lease of 40,000 is due in December.', '[
  {"op":"ledger_entry","nature":"operating_expense","status":"planned","amount_paise":4000000,"description_en":"Land lease","party_name":"Landlord","party_kind":"landlord","due_on":"2026-12-01","date_precision":"unknown"},
  {"op":"ledger_entry","nature":"operating_expense","status":"estimate","amount_paise":800000,"description_en":"Tractor repair estimate","date_precision":"unknown"}]'));
select is((pg_temp.report()->>'operating_expense_paise')::bigint, 1200000::bigint, 'a planned payment or estimate is not spending');
select is(jsonb_array_length(pg_temp.report()->'planned'), 2, 'planned payments and estimates are listed separately');
select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000409', null, 'Paid the land lease.', format('[{"op":"ledger_entry","nature":"operating_expense","amount_paise":4000000,"description_en":"Land lease paid","party_name":"Landlord","occurred_on_start":"2026-12-01","fulfils_entry_id":"%s"}]', pg_temp.op_id('lease', 0))::jsonb);
select is(jsonb_array_length(pg_temp.report()->'planned'), 1, 'paying a planned obligation removes it from what is due');
select throws_ok(
  format($$select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000410', null, 'x', '[{"op":"ledger_entry","nature":"operating_expense","amount_paise":4000000,"description_en":"Paid again","fulfils_entry_id":"%s"}]')$$, pg_temp.op_id('lease', 0)),
  '42501', 'planned payment is not available', 'a planned payment cannot be fulfilled twice'
);

-- Approximate dates are not guessed into a month.
select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000411', null, 'Last week we paid 900 for transport.', '[
  {"op":"ledger_entry","nature":"operating_expense","amount_paise":90000,"description_en":"Transport","date_precision":"approximate","date_expression":"last week","occurred_on_start":"2026-10-27","occurred_on_end":"2026-11-02"}]');
select is((pg_temp.report('2026-11-01', '2026-12-01')->'uncertain_period'->>'count')::int, 1, 'a range crossing the month boundary is reported as uncertain');
select ok((pg_temp.report('2026-10-01', '2026-12-01')->>'operating_expense_paise')::bigint = 1200000 + 90000, 'and is counted in a period that contains the whole range');

-- Corrections keep history; voiding respects dependents.
select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000412', null, 'The seeds cost 11,500, not 12,000.',
  format('[{"op":"correct_entry","entry_id":"%s","changes":{"amount_paise":1150000},"reason":"amount corrected"}]', pg_temp.op_id('bought', 0))::jsonb);
select is((select amount_paise from public.ledger_entries where id = pg_temp.op_id('bought', 0)), 1150000::bigint, 'a correction updates the original record');
select is((select (previous_value->>'amount_paise')::bigint from public.ledger_entry_history where entry_id = pg_temp.op_id('bought', 0)), 1200000::bigint, 'and keeps the previous value');
select throws_ok(
  format($$select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000413', null, 'Undo that', '[{"op":"void_entry","entry_id":"%s"}]')$$, pg_temp.op_id('handover', 0)),
  '23503', 'entry has dependent records', 'a handover with allocations cannot simply be undone'
);
select throws_ok(
  format($$select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000414', null, 'x', '[{"op":"correct_entry","entry_id":"%s","changes":{"amount_paise":100000}}]')$$, pg_temp.op_id('handover', 0)),
  '22023', 'settlement exceeds handover', 'a handover cannot be corrected below what was already allocated and returned'
);

-- Names: a confirmed alias resolves to the canonical account.
select public.teach_gurtu_vocabulary('Ramesh', array['Ramu'], 'person', 'same', null, 'a0000000-0000-4000-8000-000000000415');
insert into r values ('ramu', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000416', null, 'Gave Ramu 300 for tea', '[{"op":"ledger_entry","nature":"personal_payment","amount_paise":30000,"description_en":"Tea","party_name":"Ramu","occurred_on_start":"2026-11-05"}]'));
select is((select p.name from public.ledger_entries e join public.ledger_parties p on p.id = e.party_id where e.id = pg_temp.op_id('ramu', 0)), 'Ramesh', 'a payment to "Ramu" goes on Ramesh''s account');

-- Repair scheduled: task, mechanic visit linked to it, advance linked to both.
insert into r values ('repair', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000417', null, 'Next Friday Ramesh should repair the tractor. Give him 5,000 advance.', '[
  {"op":"create_task","ref":"t","item_text":"Tractor repair","due_on":"2026-11-13"},
  {"op":"create_event","ref":"e","title":"Ramesh tractor repair visit","starts_at":"2026-11-13T00:00:00+05:30","ends_at":"2026-11-14T00:00:00+05:30","timezone":"Asia/Kolkata","is_all_day":true,"task_ref":"t"},
  {"op":"ledger_entry","nature":"cash_handover","amount_paise":500000,"description_en":"Advance for tractor repair","party_name":"Ramesh","task_ref":"t","event_ref":"e","occurred_on_start":"2026-11-05"}]'));
select is((select related_list_item_id from public.events where id = pg_temp.op_id('repair', 1)), pg_temp.op_id('repair', 0), 'the mechanic visit links to the repair task');
select ok((select not is_completed from public.list_items where id = pg_temp.op_id('repair', 0)), 'paying an advance does not complete the repair');

-- A planned advance is allowed, but money cannot be accounted for against it yet.
insert into r values ('planned_advance', public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000418', null, 'Will give Ramesh 2000 advance', '[{"op":"ledger_entry","nature":"cash_handover","status":"planned","amount_paise":200000,"description_en":"Advance to give","party_name":"Ramesh","due_on":"2026-11-10","date_precision":"unknown"}]'));
select throws_ok(
  format($$select public.apply_gurtu_family_plan('a0000000-0000-4000-8000-000000000419', null, 'x', '[{"op":"allocation","handover_entry_id":"%s","amount_paise":100,"description_en":"Tea","kind":"other"}]')$$, pg_temp.op_id('planned_advance', 0)),
  '22023', 'settlement target is not a cash handover', 'nothing can be accounted for against a handover that has not happened'
);

-- Household sharing and isolation.
select throws_ok(
  $$insert into public.ledger_entries(household_id, nature, direction, amount_paise, description_en, request_id, op_index, created_by_user_id) values ('30000000-0000-4000-8000-000000000401', 'income', 'in', 1, 'x', gen_random_uuid(), 0, auth.uid())$$,
  '42501', 'permission denied for table ledger_entries', 'ledger rows cannot be written directly'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000402","role":"authenticated"}', true);
select is((select count(*)::int from public.ledger_entries), 15, 'the other login in the household sees the same ledger');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000403","role":"authenticated"}', true);
select is((select count(*)::int from public.ledger_entries) + (select count(*)::int from public.ledger_allocations) + (select count(*)::int from public.ledger_parties), 0, 'another household sees no ledger data');
select is((pg_temp.report()->>'cash_out_paise')::bigint, 0::bigint, 'another household''s report is empty');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000404","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.ledger_entries), 0, 'the administrator has no cross-household ledger access');

select * from finish();
rollback;
