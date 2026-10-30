import { Temporal } from '@js-temporal/polyfill';

export interface EventWindow {
  startsAt: string;
  endsAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isEventVisibleAt(event: EventWindow, now: Date): boolean {
  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  const current = now.getTime();

  if (![startsAt, endsAt, current].every(Number.isFinite) || endsAt <= startsAt) {
    return false;
  }

  return current >= startsAt - DAY_MS && current < endsAt;
}

export function formatEventTime(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startsAt));
}

export function formatEventDate(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(startsAt));
}

export function relativeEventDay(startsAt: string, timeZone: string, now: Date): string {
  const eventDay = Temporal.Instant.from(new Date(startsAt).toISOString())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
  const currentDay = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timeZone).toPlainDate();
  const days = currentDay.until(eventDay, { largestUnit: 'days' }).days;

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  return formatEventDate(startsAt, timeZone);
}

export function localEventTimeToUtc(date: string, time: string, timeZone: string): string {
  const localDateTime = Temporal.PlainDateTime.from(`${date}T${time}:00`);
  return localDateTime
    .toZonedDateTime(timeZone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}

export function nextEventBoundary(events: EventWindow[], now: Date): Date | null {
  const current = now.getTime();
  const boundaries = events.flatMap((event) => {
    const start = Date.parse(event.startsAt) - DAY_MS;
    const end = Date.parse(event.endsAt);
    return [start, end].filter((value) => Number.isFinite(value) && value > current);
  });
  const next = Math.min(...boundaries);
  return Number.isFinite(next) ? new Date(next) : null;
}
