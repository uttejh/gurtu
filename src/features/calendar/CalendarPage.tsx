import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Plus } from '@phosphor-icons/react';
import { Temporal } from '@js-temporal/polyfill';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/PageLayout';
import { PeoplePicker } from '../shared/PeoplePicker';
import { StatusMessage } from '../../components/StatusMessage';
import { useFamilyPeople } from '../shared/useFamilyPeople';
import { useMyProfile } from '../shared/useMyProfile';
import { formatCalendarMonth } from '../../lib/calendar';
import { formatEventDate, formatEventTime, localEventTimeToUtc } from '../../lib/events';
import { supabase } from '../../lib/supabase';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  is_all_day: boolean;
  owner_household_id: string;
  event_people?: Array<{ people?: { display_name?: string } | null }>;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localDate(event: CalendarEvent): string {
  return Temporal.Instant.from(event.starts_at).toZonedDateTimeISO(event.timezone).toPlainDate().toString();
}

function nextDate(date: string): string {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}

function eventZoneLabel(zone: string): string {
  if (zone === 'Asia/Kolkata') return 'India time';
  if (zone === 'America/Toronto') return 'Toronto time';
  const label = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortGeneric' })
    .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
  return label ?? zone;
}

function eventBounds(date: string, time: string, endTime: string, zone: string, allDay: boolean) {
  if (allDay) return { startsAt: localEventTimeToUtc(date, '00:00', zone), endsAt: localEventTimeToUtc(nextDate(date), '00:00', zone) };
  if (!time) throw new Error('Choose a start time or mark this event as all day.');
  const startsAt = localEventTimeToUtc(date, time, zone);
  const endDate = endTime && endTime <= time ? nextDate(date) : date;
  const endsAt = endTime ? localEventTimeToUtc(endDate, endTime, zone) : Temporal.Instant.from(startsAt).add({ minutes: 60 }).toString();
  if (Temporal.Instant.compare(Temporal.Instant.from(endsAt), Temporal.Instant.from(startsAt)) <= 0) throw new Error('The event end must be after the start.');
  return { startsAt, endsAt };
}

function EventCard({ event, canEdit, onEdit }: { event: CalendarEvent; canEdit: boolean; onEdit: () => void }) {
  const people = (event.event_people ?? []).map((item) => item.people?.display_name).filter((name): name is string => Boolean(name));
  return (
    <article className="calendar-agenda-card">
      <div className="calendar-agenda-card__top"><h3>{event.title}</h3>{canEdit ? <button className="text-button" type="button" onClick={onEdit}>Edit</button> : null}</div>
      <p>{people.length ? `${people.join(', ')} · ` : ''}{event.is_all_day ? 'All day' : `${formatEventTime(event.starts_at, event.timezone)} · ${eventZoneLabel(event.timezone)}`}</p>
      {event.description ? <p>{event.description}</p> : null}
    </article>
  );
}

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile, loading: profileLoading, failed: profileFailed } = useMyProfile();
  const { people } = useFamilyPeople();
  const baseZone = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = Temporal.Now.zonedDateTimeISO(baseZone).toPlainDate().toString();
  const [month, setMonth] = useState(() => Temporal.PlainDate.from(today).toPlainYearMonth().toString());
  const [selectedDate, setSelectedDate] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editAllDay, setEditAllDay] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const profileZoneInitialized = useRef(false);

  const loadEvents = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data, error: queryError } = await supabase.from('events')
      .select('id,title,description,starts_at,ends_at,timezone,is_all_day,owner_household_id,event_people(people(display_name))')
      .order('starts_at', { ascending: true }).limit(500);
    if (queryError) setError('We could not load calendar events. Please try again.');
    setEvents(queryError ? [] : (data ?? []) as unknown as CalendarEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!profile?.timezone || profileZoneInitialized.current) return;
    const current = Temporal.Now.zonedDateTimeISO(profile.timezone).toPlainDate().toString();
    setSelectedDate(current);
    setDate(current);
    setMonth(Temporal.PlainDate.from(current).toPlainYearMonth().toString());
    profileZoneInitialized.current = true;
  }, [profile?.timezone]);

  const monthValue = Temporal.PlainYearMonth.from(month);
  const monthLabel = formatCalendarMonth(monthValue);
  const monthDays = monthValue.daysInMonth;
  const firstDay = Temporal.PlainDate.from({ year: monthValue.year, month: monthValue.month, day: 1 }).dayOfWeek % 7;
  const calendarCells = [...Array(firstDay).fill(null), ...Array.from({ length: monthDays }, (_, index) => index + 1)];
  while (calendarCells.length % 7) calendarCells.push(null);
  const eventsByDate = useMemo(() => {
    const result = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = localDate(event);
      result.set(key, [...(result.get(key) ?? []), event]);
    }
    return result;
  }, [events]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const monthEvents = events.filter((event) => localDate(event).startsWith(`${month}-`));
  const nextEvent = events.find((event) => Date.parse(event.ends_at) > now);
  const selectedDateLabel = Temporal.PlainDate.from(selectedDate).toLocaleString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  const eventZone = selectedPeople.length ? people.find((person) => person.id === selectedPeople[0])?.timezone || profile?.timezone || baseZone : profile?.timezone || baseZone;

  function navigateToMonth(nextMonth: Temporal.PlainYearMonth) {
    const nextDate = nextMonth.equals(Temporal.PlainDate.from(today).toPlainYearMonth())
      ? today
      : Temporal.PlainDate.from({ year: nextMonth.year, month: nextMonth.month, day: 1 }).toString();
    setMonth(nextMonth.toString());
    setSelectedDate(nextDate);
    setShowForm(false);
    setEditingEvent(null);
  }

  function resetForm(forDate = selectedDate) {
    setTitle(''); setDate(forDate); setTime(''); setEndTime(''); setAllDay(false); setSelectedPeople([]); setEditingEvent(null); setShowForm(true); setError(null); setNotice(null);
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setError('Gurtu is not connected yet.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const bounds = eventBounds(date, time, endTime, eventZone, allDay);
      const { error: createError } = await supabase.rpc('create_gurtu_event', {
        p_title: title.trim(), p_description: null, p_starts_at: bounds.startsAt, p_ends_at: bounds.endsAt,
        p_timezone: eventZone, p_is_all_day: allDay, p_person_ids: selectedPeople, p_request_id: crypto.randomUUID(),
      });
      if (createError) throw createError;
      setNotice('Event added to your calendar.'); setShowForm(false); setSelectedDate(date); setMonth(Temporal.PlainDate.from(date).toPlainYearMonth().toString()); await loadEvents();
    } catch (cause) {
      setError(cause instanceof RangeError ? 'That time is unclear because of a daylight-saving change. Please choose another time.' : cause instanceof Error ? cause.message : 'The event was not saved. Please try again.');
    } finally { setBusy(false); }
  }

  const beginEdit = useCallback((event: CalendarEvent) => {
    const start = Temporal.Instant.from(event.starts_at).toZonedDateTimeISO(event.timezone);
    setEditingEvent(event); setEditTitle(event.title); setEditDate(start.toPlainDate().toString());
    setEditTime(event.is_all_day ? '' : start.toPlainTime().toString({ smallestUnit: 'minute' })); setEditAllDay(event.is_all_day); setShowForm(false); setError(null);
  }, []);

  useEffect(() => {
    const requestedEvent = searchParams.get('edit');
    if (!requestedEvent || loading) return;
    const event = events.find((item) => item.id === requestedEvent);
    if (!event) return;
    setSelectedDate(localDate(event));
    setMonth(Temporal.PlainDate.from(localDate(event)).toPlainYearMonth().toString());
    beginEdit(event);
    setSearchParams({}, { replace: true });
  }, [beginEdit, events, loading, searchParams, setSearchParams]);

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editingEvent) return;
    setBusy(true); setError(null);
    try {
      const originalMinutes = editingEvent.is_all_day ? 0 : Math.round((Date.parse(editingEvent.ends_at) - Date.parse(editingEvent.starts_at)) / 60_000);
      const bounds = !editAllDay && originalMinutes > 0
        ? (() => {
            // Keep the event's existing duration instead of resetting it to one hour.
            if (!editTime) throw new Error('Choose a start time or mark this event as all day.');
            const startsAt = localEventTimeToUtc(editDate, editTime, editingEvent.timezone);
            return { startsAt, endsAt: Temporal.Instant.from(startsAt).add({ minutes: originalMinutes }).toString() };
          })()
        : eventBounds(editDate, editTime, '', editingEvent.timezone, editAllDay);
      const { error: updateError } = await supabase.rpc('update_gurtu_event', {
        p_event_id: editingEvent.id, p_title: editTitle.trim(), p_starts_at: bounds.startsAt, p_ends_at: bounds.endsAt,
        p_timezone: editingEvent.timezone, p_is_all_day: editAllDay, p_request_id: crypto.randomUUID(),
      });
      if (updateError) throw updateError;
      setNotice('Event updated.'); setEditingEvent(null); await loadEvents();
    } catch (cause) {
      setError(cause instanceof RangeError ? 'That time is unclear because of a daylight-saving change. Please choose another time.' : cause instanceof Error ? cause.message : 'The event was not updated. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <PageLayout title="Calendar" backTo="/">
      <section className="calendar-section" aria-label="Family calendar">
        <div className="calendar-month-heading">
          <div><h3>{monthLabel}</h3><p>{monthEvents.length ? `${monthEvents.length} ${monthEvents.length === 1 ? 'event' : 'events'} this month` : 'No events this month'}</p></div>
          <div className="calendar-month-controls">
            <button className="calendar-nav-button" type="button" onClick={() => navigateToMonth(monthValue.subtract({ months: 1 }))} aria-label="Previous month"><ArrowLeft aria-hidden="true" /></button>
            <button className="calendar-today-button" type="button" onClick={() => navigateToMonth(Temporal.PlainDate.from(today).toPlainYearMonth())}>Today</button>
            <button className="calendar-nav-button" type="button" onClick={() => navigateToMonth(monthValue.add({ months: 1 }))} aria-label="Next month"><ArrowRight aria-hidden="true" /></button>
          </div>
        </div>
        <div className="calendar-grid" role="grid" aria-label={monthLabel}>
          {WEEKDAYS.map((day) => <div className="calendar-weekday" key={day} role="columnheader">{day}</div>)}
          {calendarCells.map((day, index) => {
            if (!day) return <div className="calendar-cell calendar-cell--empty" key={`empty-${index}`} role="gridcell" />;
            const value = Temporal.PlainDate.from({ year: monthValue.year, month: monthValue.month, day }).toString();
            const hasEvents = Boolean(eventsByDate.get(value)?.length);
            return <button className={`calendar-cell${value === selectedDate ? ' is-selected' : ''}${value === today ? ' is-today' : ''}`} type="button" role="gridcell" key={value} aria-selected={value === selectedDate} aria-label={`${value}${hasEvents ? ', has events' : ''}`} onClick={() => { setSelectedDate(value); setShowForm(false); setEditingEvent(null); }}>
              <span>{day}</span>{hasEvents ? <i aria-hidden="true" /> : <i className="calendar-dot-placeholder" aria-hidden="true" />}
            </button>;
          })}
        </div>
        {!monthEvents.length && nextEvent ? <button className="calendar-next-event" type="button" onClick={() => { const next = localDate(nextEvent); setSelectedDate(next); setMonth(Temporal.PlainDate.from(next).toPlainYearMonth().toString()); setShowForm(false); }}><span>Next event</span><strong>{nextEvent.title}</strong><span>{formatEventDate(nextEvent.starts_at, nextEvent.timezone)} · Go to date</span></button> : null}
        <section className="calendar-agenda" aria-labelledby="selected-date-heading">
          <div className="calendar-agenda-heading"><div><h3 id="selected-date-heading">{selectedDateLabel}</h3><p>Selected date</p></div><span className="calendar-event-count">{selectedEvents.length} {selectedEvents.length === 1 ? 'event' : 'events'}</span></div>
          {loading ? <p className="muted-copy">Loading calendar…</p> : null}
          {!loading && !error && !selectedEvents.length && !showForm ? <p className="calendar-empty">No events on this day yet.</p> : null}
          <div className="calendar-agenda-list">{selectedEvents.map((event) => <EventCard key={event.id} event={event} canEdit={event.owner_household_id === profile?.household_id} onEdit={() => beginEdit(event)} />)}</div>
          {showForm ? <form className="calendar-form calendar-form--open" onSubmit={(event) => void addEvent(event)}>
            <h4>Add an event</h4>
            <label className="field-label" htmlFor="event-title">What is happening?</label>
            <input id="event-title" className="text-field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required autoFocus />
            <label className="field-label" htmlFor="event-date">Date</label><input id="event-date" className="text-field" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            {!allDay ? <div className="form-grid"><div><label className="field-label" htmlFor="event-time">Start time</label><input id="event-time" className="text-field" type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></div><div><label className="field-label" htmlFor="event-end-time">End time (optional)</label><input id="event-end-time" className="text-field" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div></div> : null}
            <label className="toggle-row calendar-all-day"><input type="checkbox" checked={allDay} onChange={(event) => { setAllDay(event.target.checked); setTime(''); setEndTime(''); }} /><span>All day</span></label>
            <PeoplePicker people={people} selectedIds={selectedPeople} onChange={setSelectedPeople} label="Who is this for? (optional)" />
            <p className="muted-copy calendar-zone-hint">Times shown in {eventZoneLabel(eventZone)}.</p>
            <div className="form-actions"><button className="button button--primary" type="submit" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save event'}</button><button className="button button--secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
          </form> : null}
          {editingEvent ? <form className="calendar-form calendar-form--open" onSubmit={(event) => void saveEdit(event)}>
            <h4>Update event</h4><label className="field-label" htmlFor="edit-event-title">What is happening?</label><input id="edit-event-title" className="text-field" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required />
            <label className="field-label" htmlFor="edit-event-date">Date</label><input id="edit-event-date" className="text-field" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} required />
            {!editAllDay ? <><label className="field-label" htmlFor="edit-event-time">Start time</label><input id="edit-event-time" className="text-field" type="time" value={editTime} onChange={(event) => setEditTime(event.target.value)} required /></> : null}
            <label className="toggle-row"><input type="checkbox" checked={editAllDay} onChange={(event) => { setEditAllDay(event.target.checked); setEditTime(''); }} /><span>All day</span></label>
            <p className="muted-copy calendar-zone-hint">Times shown in {eventZoneLabel(editingEvent.timezone)}.</p><div className="form-actions"><button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button><button className="button button--secondary" type="button" onClick={() => setEditingEvent(null)}>Cancel</button></div>
          </form> : null}
          {!showForm && !editingEvent ? <button className="button button--primary calendar-add-button" type="button" onClick={() => resetForm(selectedDate)}><Plus aria-hidden="true" /> Add event</button> : null}
        </section>
        {profileFailed ? <StatusMessage tone="error">Your household setup is incomplete. Please finish family setup before adding an event.</StatusMessage> : null}
        {profileLoading ? <p className="muted-copy">Loading your household time zone…</p> : null}
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        {notice ? <StatusMessage tone="success">{notice}</StatusMessage> : null}
      </section>
    </PageLayout>
  );
}
