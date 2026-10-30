import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { PageLayout } from '../../components/PageLayout';
import { PeoplePicker } from '../shared/PeoplePicker';
import { StatusMessage } from '../../components/StatusMessage';
import { useFamilyPeople } from '../shared/useFamilyPeople';
import { useMyProfile } from '../shared/useMyProfile';
import { formatEventDate, formatEventTime, localEventTimeToUtc, relativeEventDay } from '../../lib/events';
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

interface EventDraft {
  title: string;
  date: string;
  time: string;
  endTime: string;
  timeZone: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  endTimeAssumed: boolean;
}

function nextDate(date: string): string {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}

function eventZoneLabel(zone: string): string {
  if (zone === 'Asia/Kolkata') return 'India time';
  const value = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortGeneric' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')?.value;
  return value ?? zone;
}

function getEventBounds(date: string, time: string, endTime: string, zone: string, allDay: boolean) {
  if (allDay) {
    return {
      startsAt: localEventTimeToUtc(date, '00:00', zone),
      endsAt: localEventTimeToUtc(nextDate(date), '00:00', zone),
      endTimeAssumed: false,
    };
  }
  if (!time) throw new Error('Please add a start time.');
  const startsAt = localEventTimeToUtc(date, time, zone);
  if (!endTime) {
    return {
      startsAt,
      endsAt: Temporal.Instant.from(startsAt).add({ minutes: 60 }).toString(),
      endTimeAssumed: true,
    };
  }
  const endDate = endTime <= time ? nextDate(date) : date;
  const endsAt = localEventTimeToUtc(endDate, endTime, zone);
  if (Temporal.Instant.compare(Temporal.Instant.from(endsAt), Temporal.Instant.from(startsAt)) <= 0) {
    throw new Error('The event end must be after the start.');
  }
  return { startsAt, endsAt, endTimeAssumed: false };
}

function EventCard({ event, canEdit, onEdit }: { event: CalendarEvent; canEdit: boolean; onEdit: () => void }) {
  const people = (event.event_people ?? []).map((entry) => entry.people?.display_name).filter((name): name is string => Boolean(name));
  return (
    <article className="record-card event-record-card">
      <div className="event-record__topline">
        <span className="event-date-pill">{relativeEventDay(event.starts_at, event.timezone, new Date())}</span>
        {canEdit ? <button className="text-button" type="button" onClick={onEdit}>Edit</button> : <span className="shared-label">Shared with your household</span>}
      </div>
      <h3>{event.title}</h3>
      {event.description ? <p>{event.description}</p> : null}
      <p className="event-meta">
        {formatEventDate(event.starts_at, event.timezone)} · {event.is_all_day ? 'All day' : `${formatEventTime(event.starts_at, event.timezone)} · ${eventZoneLabel(event.timezone)}`}
      </p>
      {people.length ? <div className="tag-list">{people.map((name) => <span className="person-tag" key={name}>{name}</span>)}</div> : null}
    </article>
  );
}

export function CalendarPage() {
  const { profile, loading: profileLoading, failed: profileFailed } = useMyProfile();
  const { people } = useFamilyPeople();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [reviewDraft, setReviewDraft] = useState<EventDraft | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editDraft, setEditDraft] = useState<EventDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const zoneOptions = useMemo(() => {
    const zones = [profile?.timezone, ...selectedPeople.map((id) => people.find((person) => person.id === id)?.timezone)]
      .filter((value): value is string => Boolean(value));
    return [...new Set(zones)];
  }, [people, profile?.timezone, selectedPeople]);

  const loadEvents = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await supabase
      .from('events')
      .select('id,title,description,starts_at,ends_at,timezone,is_all_day,owner_household_id,event_people(people(display_name))')
      .order('starts_at', { ascending: true })
      .limit(250);
    setEvents(queryError ? [] : (data ?? []) as unknown as CalendarEvent[]);
    if (queryError) setError('We could not load calendar events. Please try again.');
    setLoading(false);
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    if (!timeZone && zoneOptions.length) setTimeZone(zoneOptions[0]);
  }, [timeZone, zoneOptions]);

  function clearReview() {
    setReviewDraft(null);
    setError(null);
  }

  function reviewNewEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!date || !timeZone) {
      setError('Please choose a date and time zone.');
      return;
    }
    try {
      const bounds = getEventBounds(date, time, endTime, timeZone, allDay);
      setReviewDraft({ title: title.trim(), date, time, endTime, timeZone, allDay, ...bounds });
    } catch (cause) {
      setError(cause instanceof RangeError ? 'That local time is unclear because of a daylight-saving change. Please choose another time.' : cause instanceof Error ? cause.message : 'Please check the event date and time.');
    }
  }

  async function createEvent() {
    if (!supabase || !profile || !reviewDraft) return;
    setBusy(true);
    setError(null);
    const { error: createError } = await supabase.rpc('create_gurtu_event', {
      p_title: reviewDraft.title,
      p_description: null,
      p_starts_at: reviewDraft.startsAt,
      p_ends_at: reviewDraft.endsAt,
      p_timezone: reviewDraft.timeZone,
      p_is_all_day: reviewDraft.allDay,
      p_person_ids: selectedPeople,
      p_request_id: crypto.randomUUID(),
    });
    setBusy(false);
    if (createError) {
      setError("Your event wasn't saved. Please check your family setup and try again.");
      return;
    }
    setNotice('Event added to your calendar.');
    setTitle('');
    setDate('');
    setTime('');
    setEndTime('');
    setSelectedPeople([]);
    setReviewDraft(null);
    await loadEvents();
  }

  function beginEdit(event: CalendarEvent) {
    const starts = Temporal.Instant.from(event.starts_at).toZonedDateTimeISO(event.timezone);
    const ends = Temporal.Instant.from(event.ends_at).toZonedDateTimeISO(event.timezone);
    setEditingEvent(event);
    setEditDraft({
      title: event.title,
      date: starts.toPlainDate().toString(),
      time: event.is_all_day ? '' : starts.toPlainTime().toString({ smallestUnit: 'minute' }),
      endTime: event.is_all_day ? '' : ends.toPlainTime().toString({ smallestUnit: 'minute' }),
      timeZone: event.timezone,
      allDay: event.is_all_day,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      endTimeAssumed: false,
    });
    setError(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingEvent || !editDraft) return;
    setBusy(true);
    setError(null);
    try {
      const bounds = getEventBounds(editDraft.date, editDraft.time, editDraft.endTime, editDraft.timeZone, editDraft.allDay);
      const { error: updateError } = await supabase.rpc('update_gurtu_event', {
        p_event_id: editingEvent.id,
        p_title: editDraft.title.trim(),
        p_starts_at: bounds.startsAt,
        p_ends_at: bounds.endsAt,
        p_timezone: editDraft.timeZone,
        p_is_all_day: editDraft.allDay,
        p_request_id: crypto.randomUUID(),
      });
      if (updateError) throw updateError;
      setNotice('Event updated.');
      setEditingEvent(null);
      setEditDraft(null);
      await loadEvents();
    } catch (cause) {
      setError(cause instanceof RangeError ? 'That local time is unclear because of a daylight-saving change. Please choose another time.' : "The event wasn't updated. Please check the date and time and try again.");
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();
  const upcoming = events.filter((event) => Date.parse(event.ends_at) > now.getTime());
  const past = events.filter((event) => Date.parse(event.ends_at) <= now.getTime()).reverse();

  return (
    <PageLayout title="Calendar" backTo="/">
      <section className="page-section calendar-section">
        <p className="section-lead">Family appointments and events, shown in the right household time.</p>
        <form className="calendar-form" onSubmit={reviewNewEvent}>
          <h3>Add an event</h3>
          <label className="field-label" htmlFor="event-title">What is happening?</label>
          <input id="event-title" className="text-field" value={title} onChange={(event) => { setTitle(event.target.value); clearReview(); }} maxLength={160} required />
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="event-date">Date</label>
              <input id="event-date" className="text-field" type="date" value={date} onChange={(event) => { setDate(event.target.value); clearReview(); }} required />
            </div>
            {!allDay ? (
              <div>
                <label className="field-label" htmlFor="event-time">Start time</label>
                <input id="event-time" className="text-field" type="time" value={time} onChange={(event) => { setTime(event.target.value); clearReview(); }} required />
              </div>
            ) : null}
            {!allDay ? (
              <div>
                <label className="field-label" htmlFor="event-end-time">End time (optional)</label>
                <input id="event-end-time" className="text-field" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); clearReview(); }} />
              </div>
            ) : null}
          </div>
          <label className="toggle-row"><input type="checkbox" checked={allDay} onChange={(event) => { setAllDay(event.target.checked); setTime(''); setEndTime(''); clearReview(); }} /> <span>All day</span></label>
          <div>
            <label className="field-label" htmlFor="event-timezone">Time zone</label>
            {zoneOptions.length > 1 ? (
              <select id="event-timezone" className="text-field" value={timeZone} onChange={(event) => { setTimeZone(event.target.value); clearReview(); }}>
                {zoneOptions.map((zone) => <option value={zone} key={zone}>{zone}</option>)}
              </select>
            ) : <p className="zone-display">{timeZone || 'Loading household time zone…'}</p>}
            <p className="muted-copy">Events default to the selected family member’s home time zone.</p>
          </div>
          <PeoplePicker people={people} selectedIds={selectedPeople} onChange={(ids) => {
            setSelectedPeople(ids);
            const personZone = people.find((person) => person.id === ids[0])?.timezone;
            setTimeZone(personZone || profile?.timezone || '');
            clearReview();
          }} label="Who is this for? (optional)" />
          {reviewDraft ? (
            <div className="confirmation-panel" aria-live="polite">
              <h4>Check these event details</h4>
              <p><strong>{reviewDraft.title}</strong></p>
              <p>{reviewDraft.date} · {reviewDraft.allDay ? 'All day' : `${reviewDraft.time} · ${reviewDraft.timeZone}`}</p>
              {reviewDraft.endTimeAssumed ? <p className="muted-copy">The event will end one hour after it starts.</p> : null}
              <button className="button button--primary" type="button" onClick={() => void createEvent()} disabled={busy}>{busy ? 'Saving…' : 'Confirm and add event'}</button>
            </div>
          ) : <button className="button button--primary" type="submit" disabled={busy || !title.trim()}>Review event</button>}
        </form>

        {profileFailed ? <StatusMessage tone="error">Your household setup is incomplete. Please finish family setup before adding an event.</StatusMessage> : null}
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        {notice ? <StatusMessage tone="success">{notice}</StatusMessage> : null}
        {profileLoading || loading ? <p className="muted-copy">Loading calendar…</p> : null}
        {!loading && upcoming.length === 0 ? <p className="empty-state">No future events yet.</p> : null}
        <div className="event-list">
          {upcoming.map((event) => (
            <div key={event.id}>
              {editingEvent?.id === event.id && editDraft ? (
                <form className="calendar-form edit-event-form" onSubmit={saveEdit}>
                  <h3>Update event</h3>
                  <label className="field-label" htmlFor={`edit-title-${event.id}`}>Event name</label>
                  <input id={`edit-title-${event.id}`} className="text-field" value={editDraft.title} onChange={(change) => setEditDraft({ ...editDraft, title: change.target.value })} required />
                  <label className="field-label" htmlFor={`edit-date-${event.id}`}>Date</label>
                  <input id={`edit-date-${event.id}`} className="text-field" type="date" value={editDraft.date} onChange={(change) => setEditDraft({ ...editDraft, date: change.target.value })} required />
                  {!editDraft.allDay ? <><label className="field-label" htmlFor={`edit-time-${event.id}`}>Start time</label><input id={`edit-time-${event.id}`} className="text-field" type="time" value={editDraft.time} onChange={(change) => setEditDraft({ ...editDraft, time: change.target.value })} required /></> : null}
                  <label className="toggle-row"><input type="checkbox" checked={editDraft.allDay} onChange={(change) => setEditDraft({ ...editDraft, allDay: change.target.checked, time: '', endTime: '' })} /> <span>All day</span></label>
                  <p className="muted-copy">{editDraft.timeZone}</p>
                  <div className="form-actions">
                    <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save event changes'}</button>
                    <button className="button button--secondary" type="button" onClick={() => { setEditingEvent(null); setEditDraft(null); }}>Cancel</button>
                  </div>
                </form>
              ) : <EventCard event={event} canEdit={event.owner_household_id === profile?.household_id} onEdit={() => beginEdit(event)} />}
            </div>
          ))}
        </div>

        {past.length ? (
          <section className="past-events" aria-labelledby="past-events-heading">
            <h3 id="past-events-heading">Past events</h3>
            <div className="event-list">{past.map((event) => <EventCard key={event.id} event={event} canEdit={false} onEdit={() => undefined} />)}</div>
          </section>
        ) : null}
      </section>
    </PageLayout>
  );
}
