import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { formatCalendarMonth } from '../../src/lib/calendar';

describe('calendar month labels', () => {
  it('formats month headings across the calendar boundary without Temporal locale errors', () => {
    expect(formatCalendarMonth(Temporal.PlainYearMonth.from('2026-10'))).toBe('October 2026');
    expect(formatCalendarMonth(Temporal.PlainYearMonth.from('2027-02'))).toBe('February 2027');
  });
});
