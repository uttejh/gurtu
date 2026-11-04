import { describe, expect, it } from 'vitest';
import { formatTurns, resolvePeopleIds, validateExtraction, type CandidateMemory, type TurnMessage } from '../../supabase/functions/_shared/memory-rules';

const messages: TurnMessage[] = [
  { id: 'u1', role: 'user', content: 'వచ్చే వారం రమేష్ కి డబ్బులు ఇవ్వాలి.', created_at: '2026-11-02T09:00:00.000Z' },
  { id: 'a1', role: 'assistant', content: 'Saved to your family memories.', created_at: '2026-11-02T09:00:02.000Z', metadata: { kind: 'saved' } },
  { id: 'u2', role: 'user', content: 'Tractor repair done last week.', created_at: '2026-11-02T09:01:00.000Z' },
];
const candidates: CandidateMemory[] = [{ id: '7b0c3f5e-2f1a-4c39-9a4e-1d2b3c4d5e6f', english_text: 'Tractor repair planned.', status: 'current', memory_type: 'plan', created_at: '2026-10-30T00:00:00.000Z' }];
const memory = (overrides: Record<string, unknown>) => ({
  english_text: 'Ramesh must be paid next week.', memory_type: 'plan', status: 'current', people: ['Ramesh'],
  occurred_on_start: null, occurred_on_end: null, date_precision: null, source_message_numbers: [1], ...overrides,
});

describe('conversation memory extraction rules', () => {
  it('numbers the turns and marks saved records and answers as context', () => {
    const text = formatTurns(messages, 'Parents');
    expect(text).toContain('[1] 2026-11-02 Parents: వచ్చే వారం');
    expect(text).toContain('[2] 2026-11-02 Gurtu (this was saved as a family record; it is indexed separately)');
  });

  it('keeps valid memories and updates that point at known records', () => {
    const result = validateExtraction({
      summary_en: ' Ramesh is owed money; the tractor was repaired. ',
      memories: [memory({}), memory({ english_text: 'The tractor was repaired last week.', memory_type: 'completed_action', status: 'completed', occurred_on_start: '2026-10-26', occurred_on_end: '2026-11-01', date_precision: 'approximate', source_message_numbers: [3] })],
      updates: [{ memory_id: candidates[0].id, status: 'completed', replaced_by_index: 1 }],
    }, messages, candidates);
    expect(result?.summary_en).toBe('Ramesh is owed money; the tractor was repaired.');
    expect(result?.memories).toHaveLength(2);
    expect(result?.memories[1]).toMatchObject({ occurred_on_start: '2026-10-26', occurred_on_end: '2026-11-01', date_precision: 'approximate' });
    expect(result?.updates).toEqual([{ memory_id: candidates[0].id, status: 'completed', replaced_by_index: 1 }]);
  });

  it('drops memories sourced only from Gurtu replies or unknown messages', () => {
    const result = validateExtraction({ summary_en: 'x', memories: [memory({ source_message_numbers: [2] }), memory({ source_message_numbers: [9] })], updates: [] }, messages, candidates);
    expect(result?.memories).toHaveLength(0);
  });

  it('does not turn a question, or the answer to it, into a fact the family member stated', () => {
    const asked: TurnMessage[] = [
      { id: 'q1', role: 'user', content: 'బోర్ మోటార్ ఎవరు రిపేర్ చేశారు?', created_at: '2026-11-04T09:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: 'Suresh repaired it.', created_at: '2026-11-04T09:00:02.000Z', metadata: { kind: 'answer' } },
    ];
    const result = validateExtraction({ summary_en: 'Mom asked who repaired the bore motor.', memories: [memory({ english_text: 'Suresh repaired the bore motor.', source_message_numbers: [1] })], updates: [] }, asked, []);
    expect(result?.memories).toEqual([]);
  });

  it('refuses invented record IDs, bad dates and unsupported types', () => {
    const result = validateExtraction({
      summary_en: 'x',
      memories: [memory({ occurred_on_start: '2026-02-30', date_precision: 'exact' }), memory({ memory_type: 'rumour' })],
      updates: [{ memory_id: '00000000-0000-4000-8000-000000000000', status: 'completed', replaced_by_index: 0 }, { memory_id: candidates[0].id, status: 'deleted', replaced_by_index: null }],
    }, messages, candidates);
    expect(result?.memories).toHaveLength(1);
    expect(result?.memories[0]).toMatchObject({ occurred_on_start: null, date_precision: null });
    expect(result?.updates).toEqual([]);
  });

  it('returns null without a usable summary so the job retries', () => {
    expect(validateExtraction({ summary_en: '  ', memories: [], updates: [] }, messages, candidates)).toBeNull();
    expect(validateExtraction(null, messages, candidates)).toBeNull();
  });

  it('tags people only on an exact, unambiguous name or alias match', () => {
    const people = [
      { id: 'p1', displayName: 'Ramesh', aliases: ['రమేష్', 'Ramu'] },
      { id: 'p2', displayName: 'Suresh', aliases: ['Ramu'] },
    ];
    expect(resolvePeopleIds(['ramesh', 'రమేష్'], people)).toEqual(['p1']);
    expect(resolvePeopleIds(['Ramu'], people)).toEqual([]);
    expect(resolvePeopleIds(['Rames'], people)).toEqual([]);
  });
});
