import type { Temporal } from '@js-temporal/polyfill';

export function formatCalendarMonth(month: Temporal.PlainYearMonth): string {
  const value = new Date(Date.UTC(month.year, month.month - 1, 1));
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(value);
}
