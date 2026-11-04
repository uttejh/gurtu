import { describe, expect, it } from 'vitest';
import { planSummary, resolvePlan, type PlanContext } from '../../supabase/functions/_shared/plan';

const context: PlanContext = {
  today: '2026-11-05',
  timeZone: 'Asia/Kolkata',
  allowedZones: ['Asia/Kolkata'],
  openTasks: [{ id: 'task-1', text: 'Buy cotton seeds', list_title: 'Tasks', due_on: '2026-11-06' }, { id: 'task-2', text: 'Tractor repair', list_title: 'Tasks', due_on: null }],
  openHandovers: [{ id: 'handover-1', description: 'Cash given to Ramesh', party: 'Ramesh', amount_paise: 1_000_000, remaining_paise: 1_000_000 }],
  planned: [{ id: 'planned-1', description: 'Land lease', party: 'Landlord', amount_paise: 4_000_000, due_on: '2026-12-01', status: 'planned' }],
  recentEntries: [{ id: 'entry-1', description_en: 'Diesel', party: 'Suresh', category: 'Fuel', amount_paise: 200_000, occurred_on_start: '2026-11-04', nature: 'operating_expense', status: 'actual' }],
};
const op = (fields: Record<string, unknown>) => ({ ref: null, ...fields });

describe('Farm Kharchu plans', () => {
  it('turns a completed purchase into one expense linked to the open task, dated today when no date is said', () => {
    const result = resolvePlan([
      op({ op: 'ledger_entry', nature: 'operating_expense', amount: '12,000', description_en: 'Cotton seeds', category_name: 'Seeds', task_number: 1 }),
      op({ op: 'complete_task', task_number: 1 }),
    ], context, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toMatchObject({ op: 'ledger_entry', amount_paise: 1_200_000, occurred_on_start: '2026-11-05', date_precision: 'exact', list_item_id: 'task-1' });
    expect(result.operations[1]).toEqual({ op: 'complete_task', list_item_id: 'task-1', label: 'Buy cotton seeds' });
    expect(result.confirm).toBeNull();
  });

  it('records a handover with allocations and a return, and confirms it is fully accounted for', () => {
    const result = resolvePlan([
      op({ op: 'ledger_entry', ref: 'h1', nature: 'cash_handover', amount: '10000', description_en: 'Cash given to Ramesh', party_name: 'Ramesh' }),
      op({ op: 'allocation', handover_ref: 'h1', amount: '2000', description_en: 'Seeds', allocation_kind: 'farm_purchase' }),
      op({ op: 'allocation', handover_ref: 'h1', amount: '1500', description_en: 'Diesel', allocation_kind: 'farm_purchase' }),
      op({ op: 'allocation', handover_ref: 'h1', amount: '500', description_en: 'Personal use', allocation_kind: 'personal' }),
      op({ op: 'ledger_entry', nature: 'cash_returned', handover_ref: 'h1', amount: '6000', description_en: 'Returned' }),
    ], context, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(planSummary(result.operations, context, false)).toContain('That money is fully accounted for.');
  });

  it('asks instead of guessing when allocations exceed the handover', () => {
    const result = resolvePlan([
      op({ op: 'ledger_entry', ref: 'h1', nature: 'cash_handover', amount: '5000', description_en: 'Cash given to Ramesh' }),
      op({ op: 'allocation', handover_ref: 'h1', amount: '4000', description_en: 'Seeds' }),
      op({ op: 'allocation', handover_ref: 'h1', amount: '2000', description_en: 'Diesel' }),
    ], context, false);
    expect(result).toEqual({ ok: false, question: expect.stringContaining('₹6,000, which is more than the ₹5,000') });
  });

  it('settles money given earlier by number and reports what is still outstanding', () => {
    const result = resolvePlan([op({ op: 'allocation', handover_number: 1, amount: '2000', description_en: 'Seeds' })], context, false);
    expect(result.ok && result.operations[0]).toMatchObject({ handover_entry_id: 'handover-1' });
    if (result.ok) expect(planSummary(result.operations, context, false)).toContain('₹8,000 is not yet accounted for.');
  });

  it('never accepts invented record numbers', () => {
    expect(resolvePlan([op({ op: 'complete_task', task_number: 9 })], context, false)).toMatchObject({ ok: false });
    expect(resolvePlan([op({ op: 'ledger_entry', nature: 'cash_returned', amount: '100', description_en: 'Returned' })], context, false)).toMatchObject({ ok: false });
    expect(resolvePlan([op({ op: 'allocation', handover_ref: 'nope', amount: '100', description_en: 'x' })], context, false)).toMatchObject({ ok: false });
  });

  it('asks for a missing amount and refuses an actual payment dated in the future', () => {
    expect(resolvePlan([op({ op: 'ledger_entry', nature: 'operating_expense', amount: null, description_en: 'Labour' })], context, false))
      .toEqual({ ok: false, question: 'How much was it for “Labour”?' });
    expect(resolvePlan([op({ op: 'ledger_entry', nature: 'operating_expense', amount: '500', description_en: 'Labour', occurred_on_start: '2026-11-20' })], context, false))
      .toMatchObject({ ok: false });
  });

  it('keeps "last week" approximate and a due payment out of the dates actually spent', () => {
    const result = resolvePlan([
      op({ op: 'ledger_entry', nature: 'operating_expense', amount: '900', description_en: 'Transport', date_precision: 'approximate', occurred_on_start: '2026-10-26', occurred_on_end: '2026-11-01', date_expression: 'last week' }),
      op({ op: 'ledger_entry', nature: 'operating_expense', status: 'planned', amount: '40000', description_en: 'Land lease', due_on: '2026-12-01', date_precision: 'unknown' }),
    ], context, false);
    expect(result.ok && result.operations[0]).toMatchObject({ date_precision: 'approximate', occurred_on_start: '2026-10-26', occurred_on_end: '2026-11-01' });
    expect(result.ok && result.operations[1]).toMatchObject({ status: 'planned', due_on: '2026-12-01', occurred_on_start: null });
  });

  it('warns about a likely duplicate without blocking a genuine repeat payment', () => {
    const result = resolvePlan([op({ op: 'ledger_entry', nature: 'operating_expense', amount: '2000', description_en: 'Diesel', party_name: 'suresh', occurred_on_start: '2026-11-05' })], context, false);
    expect(result.ok && result.confirm).toContain('There is already ₹2,000 to Suresh on 2026-11-04');
  });

  it('asks before undoing an entry and corrects only what changed', () => {
    const undo = resolvePlan([op({ op: 'void_entry', entry_number: 1 })], context, false);
    expect(undo.ok && undo.confirm).toBe('Should I undo “Diesel (₹2,000, 2026-11-04)”?');
    const fix = resolvePlan([op({ op: 'correct_entry', entry_number: 1, new_amount: '2,500', new_occurred_on_start: '2026-11-03' })], context, false);
    expect(fix.ok && fix.operations[0]).toMatchObject({ entry_id: 'entry-1', changes: { amount_paise: 250_000, occurred_on_start: '2026-11-03', occurred_on_end: null, date_precision: 'exact' } });
  });

  it('links a payment to a planned obligation and answers in Telugu', () => {
    const result = resolvePlan([op({ op: 'ledger_entry', nature: 'operating_expense', amount: '40000', description_en: 'Land lease', fulfils_number: 1 })], context, true);
    expect(result.ok && result.operations[0]).toMatchObject({ fulfils_entry_id: 'planned-1' });
    if (result.ok) expect(planSummary(result.operations, context, true)).toMatch(/[ఀ-౿]/u);
  });
});
