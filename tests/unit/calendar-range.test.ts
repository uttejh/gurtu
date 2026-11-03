import { describe, expect, it } from 'vitest';
import { findCalendarRange, isCalendarQuestion } from '../../supabase/functions/_shared/calendar-range';

describe('calendar period questions', () => {
  it('treats "do i have any events this month?" as a calendar question for the local month', () => {
    const question = 'do i have any events this month?';
    expect(isCalendarQuestion(question)).toBe(true);
    expect(findCalendarRange(question, '2026-11-03')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-12-01' });
  });

  it('rolls next month over the year boundary', () => {
    expect(findCalendarRange('any events next month', '2026-12-15')).toMatchObject({ startDate: '2027-01-01', endDate: '2027-02-01' });
  });

  it('uses Monday-start weeks', () => {
    // 2026-11-05 is a Thursday.
    expect(findCalendarRange('what is on this week', '2026-11-05')).toMatchObject({ startDate: '2026-11-02', endDate: '2026-11-09' });
    expect(findCalendarRange('anything next week?', '2026-11-08')).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-16' });
  });

  it('handles today and tomorrow, including the end of a month', () => {
    expect(findCalendarRange('events today', '2026-11-30')).toMatchObject({ startDate: '2026-11-30', endDate: '2026-12-01' });
    expect(findCalendarRange('events tomorrow', '2026-11-30')).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-02' });
  });

  it('understands Telugu periods', () => {
    expect(isCalendarQuestion('ఈ నెల ఈవెంట్లు ఉన్నాయా?')).toBe(true);
    expect(findCalendarRange('ఈ నెల ఈవెంట్లు ఉన్నాయా?', '2026-02-10')).toMatchObject({ startDate: '2026-02-01', endDate: '2026-03-01' });
    expect(findCalendarRange('రేపు ఏమి ఉంది', '2026-02-28')).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-02' });
  });

  it('returns no range when no period is named', () => {
    expect(findCalendarRange('when is the bank appointment?', '2026-11-03')).toBeNull();
  });
});
