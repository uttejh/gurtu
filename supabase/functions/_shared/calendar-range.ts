export interface CalendarRange {
  /** Inclusive local start date (YYYY-MM-DD) in the household time zone. */
  startDate: string;
  /** Exclusive local end date (YYYY-MM-DD) in the household time zone. */
  endDate: string;
  label: { en: string; te: string };
}

function parseDate(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) throw new Error('Invalid local date.');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function monthStart(value: Date, offset: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
}

function weekStart(value: Date): Date {
  // Weeks start on Monday.
  const weekday = (value.getUTCDay() + 6) % 7;
  return addDays(value, -weekday);
}

/**
 * Finds a calendar period named in a question ("this month", "next week",
 * "ఈ నెల", "రేపు", …) relative to the household-local date `today`.
 * Uses plain UTC date arithmetic on local calendar dates, so it has no
 * time-zone dependency itself.
 */
export function findCalendarRange(question: string, today: string): CalendarRange | null {
  const text = question.normalize('NFKC').toLocaleLowerCase();
  const day = parseDate(today);
  const range = (start: Date, end: Date, en: string, te: string): CalendarRange => ({
    startDate: formatDate(start), endDate: formatDate(end), label: { en, te },
  });

  if (/\blast year\b|\bprevious year\b|పోయిన\s*(?:సంవత్సరం|ఏడాది)|గత\s*(?:సంవత్సరం|ఏడాది)/u.test(text)) {
    const year = day.getUTCFullYear() - 1;
    return range(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)), 'last year', 'పోయిన సంవత్సరం');
  }
  if (/\b(?:this|current) year\b|ఈ\s*(?:సంవత్సరం|ఏడాది)|ee\s+samvatsaram/u.test(text)) {
    const year = day.getUTCFullYear();
    return range(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)), 'this year', 'ఈ సంవత్సరం');
  }
  if (/\blast month\b|\bprevious month\b|పోయిన\s*నెల|గత\s*నెల|poyina\s+nela/u.test(text)) {
    return range(monthStart(day, -1), monthStart(day, 0), 'last month', 'పోయిన నెల');
  }
  if (/\blast week\b|\bprevious week\b|పోయిన\s*వారం|గత\s*వారం|poyina\s+vaaram/u.test(text)) {
    const start = addDays(weekStart(day), -7);
    return range(start, addDays(start, 7), 'last week', 'పోయిన వారం');
  }
  if (/\bnext month\b|వచ్చే\s*నెల|తర్వాతి\s*నెల|vache\s+nela/u.test(text)) {
    return range(monthStart(day, 1), monthStart(day, 2), 'next month', 'వచ్చే నెల');
  }
  if (/\b(?:this|current) month\b|ఈ\s*నెల|ee\s+nela/u.test(text)) {
    return range(monthStart(day, 0), monthStart(day, 1), 'this month', 'ఈ నెల');
  }
  if (/\bnext week\b|వచ్చే\s*వారం|vache\s+vaaram/u.test(text)) {
    const start = addDays(weekStart(day), 7);
    return range(start, addDays(start, 7), 'next week', 'వచ్చే వారం');
  }
  if (/\b(?:this|current) week\b|ఈ\s*వారం|ee\s+vaaram/u.test(text)) {
    const start = weekStart(day);
    return range(start, addDays(start, 7), 'this week', 'ఈ వారం');
  }
  if (/\btomorrow\b|రేపు|\brepu\b/u.test(text)) {
    return range(addDays(day, 1), addDays(day, 2), 'tomorrow', 'రేపు');
  }
  if (/\btoday\b|ఈ\s*రోజు|ఈరోజు|ఇవాళ|\beeroju\b|\bivala\b/u.test(text)) {
    return range(day, addDays(day, 1), 'today', 'ఈ రోజు');
  }
  return null;
}

/** True when the question is about calendar events rather than other records. */
export function isCalendarQuestion(question: string): boolean {
  return /\b(calendar|schedule|events?|appointments?|plans?|planned|busy|free|coming up|what(?:'s| is) on)\b/iu.test(question)
    || /(?:క్యాలెండర్|ఈవెంట్|కార్యక్రమ|షెడ్యూల్|అపాయింట్|పనులు|ఏమి ఉంది|ఏం ఉంది)/u.test(question);
}
