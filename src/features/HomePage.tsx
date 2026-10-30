import { useCallback, useEffect, useState } from 'react';
import { CalendarBlank, ChatCircle, ClockCounterClockwise, ListBullets, Microphone, NotePencil } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { LogoutButton } from '../../components/LogoutButton';
import { Brand } from '../../components/Brand';
import { StatusMessage } from '../../components/StatusMessage';
import { useAuth } from '../../app/useAuth';
import { formatEventTime, isEventVisibleAt, nextEventBoundary, relativeEventDay } from '../../lib/events';
import { supabase } from '../../lib/supabase';

interface HomeEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  is_all_day: boolean;
  event_people?: Array<{ people?: { display_name?: string } | null }>;
}

const PREVIEW_EVENT: HomeEvent = {
  id: 'preview-bank-appointment',
  title: 'Bank appointment',
  starts_at: '2026-10-31T04:30:00.000Z',
  ends_at: '2026-10-31T05:30:00.000Z',
  timezone: 'Asia/Kolkata',
  is_all_day: false,
  event_people: [{ people: { display_name: 'Dad' } }],
};

function eventTimeZoneLabel(timeZone: string): string {
  if (timeZone === 'Asia/Kolkata') return 'India time';
  const part = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'shortGeneric' })
    .formatToParts(new Date())
    .find((value) => value.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

function eventWindow(event: HomeEvent) {
  return { startsAt: event.starts_at, endsAt: event.ends_at };
}

function HomeEventCard({ event, now }: { event: HomeEvent; now: Date }) {
  const people = (event.event_people ?? [])
    .map((link) => link.people?.display_name)
    .filter((name): name is string => Boolean(name));

  return (
    <article className="event-card">
      <span className="event-date-pill">{relativeEventDay(event.starts_at, event.timezone, now)}</span>
      <h3>{event.title}</h3>
      <p className="event-meta">
        {people.length ? `${people.join(', ')} · ` : ''}
        {event.is_all_day ? 'All day' : formatEventTime(event.starts_at, event.timezone)}
        {!event.is_all_day ? ` · ${eventTimeZoneLabel(event.timezone)}` : ''}
      </p>
    </article>
  );
}

export function HomePage({ preview = false }: { preview?: boolean }) {
  const { isGlobalAdmin, adminRoleLoading } = useAuth();
  const [events, setEvents] = useState<HomeEvent[]>(preview ? [PREVIEW_EVENT] : []);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(!preview && Boolean(supabase));
  const [loadFailed, setLoadFailed] = useState(false);

  const loadEvents = useCallback(async () => {
    if (preview || !supabase) {
      setLoading(false);
      return;
    }
    setNow(new Date());
    const { data, error } = await supabase
      .from('events')
      .select('id,title,starts_at,ends_at,timezone,is_all_day,event_people(people(display_name))')
      .gt('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(250);
    if (error) {
      setLoadFailed(true);
      setEvents([]);
    } else {
      setLoadFailed(false);
      setEvents((data ?? []) as unknown as HomeEvent[]);
    }
    setLoading(false);
  }, [preview]);

  useEffect(() => {
    void loadEvents();
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') void loadEvents();
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [loadEvents]);

  useEffect(() => {
    if (preview) return;
    const boundary = nextEventBoundary(events.map(eventWindow), now);
    if (!boundary) return;
    const timer = window.setTimeout(() => {
      setNow(new Date());
    }, Math.max(0, Math.min(boundary.getTime() - now.getTime(), 2_147_000_000)) + 20);
    return () => window.clearTimeout(timer);
  }, [events, now, preview]);

  const visibleEvents = events
    .filter((event) => isEventVisibleAt(eventWindow(event), now))
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));

  return (
    <main className="app-frame home-frame">
      <div className="home-topline">
        <Brand />
        {!preview ? <LogoutButton /> : null}
      </div>

      <section className="home-actions" aria-labelledby="home-heading">
        <h2 id="home-heading">What would you like to do?</h2>
        <Link className="home-action" to="/remember">
          <Microphone className="home-action__icon" aria-hidden="true" weight="regular" />
          <span className="home-action__title">Remember something</span>
          <span className="home-action__description">Speak or type anything you want your family to remember.</span>
        </Link>
        <Link className="home-action" to="/ask">
          <ChatCircle className="home-action__icon" aria-hidden="true" weight="regular" />
          <span className="home-action__title">Ask your memory</span>
          <span className="home-action__description">Ask questions about saved information, lists, locations and events.</span>
        </Link>
      </section>

      <section className="upcoming-section" aria-labelledby="upcoming-heading">
        <div className="section-heading-row">
          <h2 id="upcoming-heading"><CalendarBlank aria-hidden="true" weight="regular" /> Upcoming events</h2>
          <Link className="section-link" to="/calendar">View calendar</Link>
        </div>
        {loading ? <p className="muted-copy">Loading events…</p> : null}
        {loadFailed ? <StatusMessage tone="error">We could not load events. Please try again.</StatusMessage> : null}
        {!loading && !loadFailed && visibleEvents.length === 0 ? <p className="muted-copy">No upcoming events right now.</p> : null}
        <div className="event-list">
          {visibleEvents.map((event) => <HomeEventCard key={event.id} event={event} now={now} />)}
        </div>
      </section>

      <nav className="secondary-nav" aria-label="More family memories">
        <Link to="/lists"><ListBullets aria-hidden="true" /> <span>Our lists</span></Link>
        <Link to="/memories"><NotePencil aria-hidden="true" /> <span>Memories</span></Link>
        <Link to="/history"><ClockCounterClockwise aria-hidden="true" /> <span>History</span></Link>
      </nav>
      {!preview && isGlobalAdmin && !adminRoleLoading ? (
        <Link className="admin-entry-link" to="/family-activity">Family Activity</Link>
      ) : null}
    </main>
  );
}
