import { describe, expect, it } from 'vitest';
import { parseUntimedFlight } from '../../supabase/functions/_shared/flight';

describe('date-only flight capture', () => {
  it('turns a date without a year or time into the next upcoming all-day event', () => {
    expect(parseUntimedFlight('I have a flight on December 3rd.', '2026-10-30', 'America/Toronto')).toEqual({
      action: 'create_event',
      title: 'Flight',
      local_date: '2026-12-03',
      local_time: null,
      end_time: null,
      time_zone: 'America/Toronto',
      all_day: true,
      people_mentions: [],
      end_time_assumed: false,
    });
  });

  it('uses next year when the date has already passed', () => {
    expect(parseUntimedFlight('My flight is on December 3rd', '2026-12-04', 'America/Toronto')?.local_date).toBe('2027-12-03');
  });

  it('does not classify a question as a new flight event', () => {
    expect(parseUntimedFlight('When is my flight on December 3rd?', '2026-10-30', 'America/Toronto')).toBeNull();
  });
});
