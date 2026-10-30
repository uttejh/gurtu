import { describe, expect, it } from 'vitest';
import { formatEventTime, isEventVisibleAt, localEventTimeToUtc, relativeEventDay } from '../../src/lib/events';

const event = {
  startsAt: '2026-11-01T04:30:00.000Z',
  endsAt: '2026-11-01T05:30:00.000Z',
  timeZone: 'Asia/Kolkata',
};

describe('home event visibility', () => {
  it('shows an event exactly 24 hours before it starts', () => {
    expect(isEventVisibleAt(event, new Date('2026-10-31T04:30:00.000Z'))).toBe(true);
  });

  it('hides an event before its 24-hour display window', () => {
    expect(isEventVisibleAt(event, new Date('2026-10-31T04:29:59.999Z'))).toBe(false);
  });

  it('keeps an event visible until its end, then hides it', () => {
    expect(isEventVisibleAt(event, new Date('2026-11-01T05:29:59.999Z'))).toBe(true);
    expect(isEventVisibleAt(event, new Date('2026-11-01T05:30:00.000Z'))).toBe(false);
  });
});

describe('event-local display', () => {
  it('formats an event in the event household time zone', () => {
    expect(formatEventTime(event.startsAt, event.timeZone)).toBe('10:00 AM');
  });

  it('labels tomorrow using the event household calendar date', () => {
    expect(relativeEventDay(event.startsAt, event.timeZone, new Date('2026-10-31T12:00:00.000Z'))).toBe('Tomorrow');
  });

  it('rejects non-existent local times during a daylight-saving transition', () => {
    expect(() => localEventTimeToUtc('2026-03-08', '02:30', 'America/Toronto')).toThrow();
  });
});
