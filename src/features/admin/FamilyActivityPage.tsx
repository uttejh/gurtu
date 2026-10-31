import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '../../components/PageLayout';
import { StatusMessage } from '../../components/StatusMessage';
import { useAuth } from '../../app/useAuth';
import { supabase } from '../../lib/supabase';

type CaptureStatus = 'transcribing' | 'received' | 'interpreting' | 'transcription_failed' | 'interpretation_failed' | 'needs_clarification' | 'awaiting_confirmation' | 'operation_pending' | 'operation_failed' | 'succeeded' | 'cancelled';
type Intent = 'save_memory' | 'save_item_location' | 'create_list' | 'add_list_items' | 'update_list_item' | 'remove_list_item' | 'create_event' | 'update_event' | 'delete_event' | 'clarify';

interface Capture {
  id: string;
  family_id: string;
  household_id: string;
  submitted_by_user_id: string;
  request_id: string;
  input_type: 'voice' | 'text';
  detected_language: string;
  detected_intent: Intent | null;
  extracted_payload: Record<string, unknown> | null;
  selected_person_ids: string[];
  processing_status: CaptureStatus;
  result_entity_type: 'memory' | 'item' | 'list' | 'event' | null;
  result_entity_id: string | null;
  error_code: string | null;
  safe_error_description: string | null;
  created_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
}

interface Household { id: string; family_id: string; name: string }
interface Profile { user_id: string; household_id: string; display_name: string }
interface Person { id: string; display_name: string }
interface AuditEntry {
  id: string;
  action: string;
  admin_user_id: string;
  created_at: string;
  target_record_type: string | null;
  target_record_id: string | null;
  previous_value: unknown;
  new_value: unknown;
  reason: string | null;
}
interface CaptureFilters { search: string; household: string; account: string; person: string; from: string; to: string; intent: string; status: string }
interface LocationEntry { location_text: string; created_at: string; correction_reason: string | null; corrected_by_admin_user_id: string | null }
interface RecordDetails { heading: string; facts: string[]; people: string[]; locations?: LocationEntry[]; listItems?: string[]; sourceMemory?: string }

const INTENT_LABEL: Record<Intent, string> = {
  save_memory: 'Save memory', save_item_location: 'Save item location', create_list: 'Create list',
  add_list_items: 'Add list items', update_list_item: 'Update list item', remove_list_item: 'Remove list item',
  create_event: 'Create event', update_event: 'Update event', delete_event: 'Delete event', clarify: 'Needs clarification',
};
const STATUS_LABEL: Record<CaptureStatus, string> = {
  transcribing: 'Transcribing', received: 'Received', interpreting: 'Interpreting',
  transcription_failed: 'Transcription failed', interpretation_failed: 'Interpretation failed',
  needs_clarification: 'Needs clarification', awaiting_confirmation: 'Awaiting confirmation',
  operation_pending: 'Save in progress', operation_failed: 'Save failed', succeeded: 'Saved', cancelled: 'Cancelled',
};
const EMPTY_FILTERS: CaptureFilters = { search: '', household: '', account: '', person: '', from: '', to: '', intent: '', status: '' };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isMissingFactor(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'mfa_factor_not_found'
    || /factor not found/iu.test(errorText(error, ''));
}

function qrImageSource(value: string) {
  return value.startsWith('data:image/') ? value : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
}

function selectedNames(ids: string[], people: Person[]) {
  const peopleById = new Map(people.map((person) => [person.id, person.display_name]));
  return ids.map((id) => peopleById.get(id)).filter((name): name is string => Boolean(name));
}

function nestedPeople(rows: Array<{ people?: { display_name?: string } | null }> | null | undefined) {
  return (rows ?? []).map((row) => row.people?.display_name).filter((name): name is string => Boolean(name));
}

function dateStart(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : '';
}

function dateEnd(value: string) {
  return value ? new Date(new Date(`${value}T00:00:00`).getTime() + 86_400_000).toISOString() : '';
}

async function getRecordDetails(capture: Capture, householdsById: Map<string, string>): Promise<RecordDetails | null> {
  if (!supabase || !capture.result_entity_id || !capture.result_entity_type) return null;
  if (capture.result_entity_type === 'memory') {
    const [{ data, error }, { data: tagRows }] = await Promise.all([
      supabase.from('memories').select('original_text,summary,created_at').eq('id', capture.result_entity_id).maybeSingle(),
      supabase.from('memory_people').select('people(display_name)').eq('memory_id', capture.result_entity_id),
    ]);
    if (error || !data) throw new Error('The saved memory could not be loaded.');
    return { heading: 'Saved memory', facts: [data.original_text, data.summary ?? 'No summary', `Saved ${formatDate(data.created_at)}`], people: nestedPeople(tagRows as Array<{ people?: { display_name?: string } | null }> | null) };
  }
  if (capture.result_entity_type === 'item') {
    const [{ data: item, error }, { data: tagRows }, { data: locationRows }] = await Promise.all([
      supabase.from('items').select('canonical_name,household_id').eq('id', capture.result_entity_id).maybeSingle(),
      supabase.from('item_people').select('people(display_name)').eq('item_id', capture.result_entity_id),
      supabase.from('item_location_history').select('location_text,created_at,correction_reason,corrected_by_admin_user_id,source_memory_id').eq('item_id', capture.result_entity_id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (error || !item) throw new Error('The saved item could not be loaded.');
    const locations = (locationRows ?? []) as unknown as Array<LocationEntry & { source_memory_id: string | null }>;
    let sourceMemory = '';
    const sourceId = locations.find((row) => row.source_memory_id)?.source_memory_id;
    if (sourceId) {
      const { data: memory } = await supabase.from('memories').select('original_text').eq('id', sourceId).maybeSingle();
      sourceMemory = memory?.original_text ?? '';
    }
    return {
      heading: `Item: ${item.canonical_name}`,
      facts: [`Household: ${householdsById.get(item.household_id) ?? 'Household'}`, `Latest reported location: ${locations[0]?.location_text ?? 'None recorded'}`],
      people: nestedPeople(tagRows as Array<{ people?: { display_name?: string } | null }> | null),
      locations,
      sourceMemory,
    };
  }
  if (capture.result_entity_type === 'list') {
    const [{ data: list, error }, { data: tagRows }, { data: itemRows }] = await Promise.all([
      supabase.from('lists').select('title,owner_household_id,created_at').eq('id', capture.result_entity_id).maybeSingle(),
      supabase.from('list_people').select('people(display_name)').eq('list_id', capture.result_entity_id),
      supabase.from('list_items').select('item_text,is_completed').eq('list_id', capture.result_entity_id).order('position'),
    ]);
    if (error || !list) throw new Error('The saved list could not be loaded.');
    return { heading: `List: ${list.title}`, facts: [`Owner household: ${householdsById.get(list.owner_household_id) ?? 'Household'}`, `Created ${formatDate(list.created_at)}`], people: nestedPeople(tagRows as Array<{ people?: { display_name?: string } | null }> | null), listItems: (itemRows ?? []).map((item) => `${item.is_completed ? '✓' : '○'} ${item.item_text}`) };
  }
  const [{ data: event, error }, { data: tagRows }] = await Promise.all([
    supabase.from('events').select('title,owner_household_id,starts_at,ends_at,timezone,is_all_day').eq('id', capture.result_entity_id).maybeSingle(),
    supabase.from('event_people').select('people(display_name)').eq('event_id', capture.result_entity_id),
  ]);
  if (error || !event) throw new Error('The saved calendar event could not be loaded.');
  return {
    heading: `Event: ${event.title}`,
    facts: [`Owner household: ${householdsById.get(event.owner_household_id) ?? 'Household'}`, event.is_all_day ? `All day · ${formatDate(event.starts_at)}` : `${formatDate(event.starts_at)} · ${event.timezone}`],
    people: nestedPeople(tagRows as Array<{ people?: { display_name?: string } | null }> | null),
  };
}

function MfaGate({ onReady }: { onReady: () => void }) {
  const [stage, setStage] = useState<'checking' | 'setup' | 'enrollment' | 'challenge' | 'incomplete' | 'error'>('checking');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const inspectFactors = useCallback(async () => {
    if (!supabase) return;
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === 'aal2') {
      setStage('checking');
      onReady();
      return;
    }
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    const verified = data.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setQrCode('');
      setSecret('');
      setStage('challenge');
      return;
    }
    const unfinished = data.all.find((factor) => factor.factor_type === 'totp' && factor.status === 'unverified');
    if (unfinished) {
      setFactorId('');
      setQrCode('');
      setSecret('');
      setStage('incomplete');
    } else {
      setFactorId('');
      setQrCode('');
      setSecret('');
      setStage('setup');
    }
  }, [onReady]);

  useEffect(() => {
    let active = true;
    void inspectFactors().catch((error: unknown) => {
      if (!active) return;
      setMessage(errorText(error, 'Administrator verification is unavailable.'));
      setStage('error');
    });
    return () => { active = false; };
  }, [inspectFactors]);

  async function beginSetup(replaceUnfinished = false) {
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      setFactorId('');
      setQrCode('');
      setSecret('');
      if (replaceUnfinished) {
        const { data: existingFactors, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const unfinishedFactors = existingFactors.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified');
        for (const factor of unfinishedFactors) {
          const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
          if (removeError && !isMissingFactor(removeError)) throw removeError;
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Gurtu administrator' });
      if (error) throw error;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStage('enrollment');
    } catch (error) {
      setMessage(errorText(error, 'Authenticator setup could not start.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !factorId || code.trim().length < 6) return;
    setBusy(true);
    setMessage('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
      if (verifyError) throw verifyError;
      setCode('');
      await inspectFactors();
    } catch (error) {
      if (isMissingFactor(error)) {
        setFactorId('');
        setQrCode('');
        setSecret('');
        setMessage('This authenticator setup is no longer active. Start a fresh setup and scan its new code.');
        try {
          await inspectFactors();
        } catch (refreshError) {
          setMessage(errorText(refreshError, 'Authenticator setup could not be refreshed. Please reload and try again.'));
          setStage('error');
        }
      } else {
        setMessage(errorText(error, 'That verification code could not be confirmed. Check it and try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'checking') return <div className="admin-mfa-panel"><p>Checking administrator verification…</p></div>;
  if (stage === 'setup' || stage === 'incomplete') {
    return (
      <section className="admin-mfa-panel" aria-labelledby="admin-mfa-title">
        <h3 id="admin-mfa-title">Set up administrator verification</h3>
        <p>Family Activity requires a one-time authenticator check. This applies only to Chinna’s administrator account.</p>
        {stage === 'incomplete' ? <p>An unfinished authenticator setup is attached to this account. Start a fresh setup to continue.</p> : null}
        <button className="button button--primary" type="button" onClick={() => void beginSetup(stage === 'incomplete')} disabled={busy}>
          {busy ? 'Starting…' : stage === 'incomplete' ? 'Replace unfinished setup' : 'Set up authenticator'}
        </button>
        {message ? <StatusMessage tone="error">{message}</StatusMessage> : null}
      </section>
    );
  }
  if (stage === 'enrollment') {
    return (
      <section className="admin-mfa-panel" aria-labelledby="admin-mfa-title">
        <h3 id="admin-mfa-title">Add Gurtu to your authenticator</h3>
        <p>Scan this code with an authenticator app, then enter its six-digit code.</p>
        {qrCode ? <img className="admin-mfa-qr" alt="Authenticator setup QR code" src={qrImageSource(qrCode)} /> : null}
        <p className="admin-mfa-secret"><span>Manual setup key</span><code>{secret}</code></p>
        <MfaCodeForm code={code} setCode={setCode} busy={busy} message={message} onSubmit={verify} buttonLabel="Verify and open Family Activity" />
      </section>
    );
  }
  if (stage === 'challenge') {
    return (
      <section className="admin-mfa-panel" aria-labelledby="admin-mfa-title">
        <h3 id="admin-mfa-title">Verify administrator access</h3>
        <p>Enter the current code from your authenticator app to review family activity.</p>
        <MfaCodeForm code={code} setCode={setCode} busy={busy} message={message} onSubmit={verify} buttonLabel="Continue" />
      </section>
    );
  }
  return <StatusMessage tone="error">{message || 'Administrator verification is unavailable.'}</StatusMessage>;
}

function MfaCodeForm({ code, setCode, busy, message, onSubmit, buttonLabel }: {
  code: string; setCode: (value: string) => void; busy: boolean; message: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; buttonLabel: string;
}) {
  return (
    <form className="admin-mfa-form" onSubmit={onSubmit}>
      <label className="field-label" htmlFor="admin-mfa-code">Authenticator code</label>
      <input id="admin-mfa-code" className="text-field" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))} />
      <button className="button button--primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : buttonLabel}</button>
      {message ? <StatusMessage tone="error">{message}</StatusMessage> : null}
    </form>
  );
}

export function FamilyActivityPage() {
  const { isGlobalAdmin, adminRoleLoading } = useAuth();
  const [aal2, setAal2] = useState(false);
  const [filters, setFilters] = useState<CaptureFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<CaptureFilters>(EMPTY_FILTERS);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [recordDetails, setRecordDetails] = useState<RecordDetails | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [correctionPeople, setCorrectionPeople] = useState<string[]>([]);
  const [correctedLocation, setCorrectedLocation] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const householdName = useMemo(() => new Map(households.map((household) => [household.id, household.name])), [households]);
  const profileName = useMemo(() => new Map(profiles.map((profile) => [profile.user_id, profile.display_name])), [profiles]);
  const selectedCapture = captures.find((capture) => capture.id === selectedId) ?? null;

  useEffect(() => {
    if (!supabase || !isGlobalAdmin || adminRoleLoading) return;
    let active = true;
    void Promise.all([
      supabase.from('households').select('id,family_id,name').order('name'),
      supabase.from('profiles').select('user_id,household_id,display_name').order('display_name'),
      supabase.from('people').select('id,display_name').eq('is_active', true).order('display_name'),
    ]).then(([householdResult, profileResult, peopleResult]) => {
      if (!active) return;
      const error = householdResult.error ?? profileResult.error ?? peopleResult.error;
      if (error) {
        setLoadError('Family filters could not be loaded. Confirm administrator verification and try again.');
        return;
      }
      setHouseholds((householdResult.data ?? []) as Household[]);
      setProfiles((profileResult.data ?? []) as Profile[]);
      setPeople((peopleResult.data ?? []) as Person[]);
    });
    return () => { active = false; };
  }, [isGlobalAdmin, adminRoleLoading]);

  const loadCaptures = useCallback(async (currentFilters: CaptureFilters) => {
    if (!supabase) return;
    setLoading(true);
    setLoadError('');
    let query = supabase.rpc('get_admin_family_activity').order('created_at', { ascending: false }).limit(1000);
    if (currentFilters.household) query = query.eq('household_id', currentFilters.household);
    if (currentFilters.account) query = query.eq('submitted_by_user_id', currentFilters.account);
    if (currentFilters.person) query = query.contains('selected_person_ids', [currentFilters.person]);
    if (currentFilters.intent) query = query.eq('detected_intent', currentFilters.intent);
    if (currentFilters.status) query = query.eq('processing_status', currentFilters.status);
    if (currentFilters.from) query = query.gte('created_at', dateStart(currentFilters.from));
    if (currentFilters.to) query = query.lt('created_at', dateEnd(currentFilters.to));
    const { data, error } = await query;
    if (error) {
      setCaptures([]);
      setLoadError('Family activity could not be loaded. Confirm administrator verification and try again.');
    } else {
      const search = currentFilters.search.trim().toLocaleLowerCase();
      const rows = (data ?? []) as unknown as Capture[];
      setCaptures(search ? rows.filter((capture) => [capture.detected_intent, capture.processing_status, JSON.stringify(capture.extracted_payload ?? {})].some((value) => value?.toLocaleLowerCase().includes(search))) : rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (aal2) void loadCaptures(appliedFilters);
  }, [aal2, appliedFilters, loadCaptures]);

  useEffect(() => {
    if (!aal2 || !selectedCapture || !supabase) return;
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    setActionMessage('');
    setActionError('');
    setCorrectionPeople(selectedCapture.selected_person_ids ?? []);
    setCorrectedLocation(String(selectedCapture.extracted_payload?.location ?? ''));
    setCorrectionReason('');
    void (async () => {
      await Promise.all([
        supabase.rpc('log_gurtu_admin_action', { p_action: 'capture_viewed', p_capture_request_id: selectedCapture.id }),
      ]);
      const [details, auditResult] = await Promise.all([
        getRecordDetails(selectedCapture, householdName),
        supabase.from('admin_audit_log').select('id,action,admin_user_id,created_at,target_record_type,target_record_id,previous_value,new_value,reason').eq('target_capture_request_id', selectedCapture.id).order('created_at', { ascending: false }).limit(100),
      ]);
      if (!active) return;
      setRecordDetails(details);
      setAuditEntries((auditResult.data ?? []) as AuditEntry[]);
      if (auditResult.error) setDetailError('The record loaded, but its audit history could not be retrieved.');
    })().catch((error: unknown) => {
      if (active) setDetailError(errorText(error, 'Capture details could not be loaded.'));
    }).finally(() => {
      if (active) setDetailLoading(false);
    });
    return () => { active = false; };
  }, [aal2, householdName, selectedCapture]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({ ...filters });
    if (supabase) await supabase.rpc('log_gurtu_admin_action', { p_action: 'family_activity_search', p_capture_request_id: null });
  }

  async function retryCapture() {
    if (!selectedCapture || !supabase) return;
    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    const { data, error } = await supabase.rpc('admin_retry_gurtu_capture', { p_capture_request_id: selectedCapture.id });
    setActionBusy(false);
    if (error) {
      setActionError('This action could not be retried. Its saved details remain available for review.');
    } else {
      const outcome = data as { ok?: boolean; reconciled?: boolean; message?: string } | null;
      setActionMessage(outcome?.reconciled ? 'An earlier save was found and linked to this capture.' : outcome?.ok ? 'The saved action completed.' : outcome?.message ?? 'The retry was recorded.');
      await loadCaptures(appliedFilters);
    }
  }

  async function savePeopleCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCapture || !supabase || correctionReason.trim().length < 3) return;
    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    const { error } = await supabase.rpc('admin_correct_capture_people', {
      p_capture_request_id: selectedCapture.id, p_person_ids: correctionPeople, p_reason: correctionReason.trim(),
    });
    setActionBusy(false);
    if (error) setActionError('The people tags could not be corrected. Check the reason and try again.');
    else {
      setActionMessage('People tags were corrected and added to the audit trail.');
      await loadCaptures(appliedFilters);
      setCorrectionReason('');
      if (supabase) {
        const { data } = await supabase.from('admin_audit_log').select('id,action,admin_user_id,created_at,target_record_type,target_record_id,previous_value,new_value,reason').eq('target_capture_request_id', selectedCapture.id).order('created_at', { ascending: false }).limit(100);
        setAuditEntries((data ?? []) as AuditEntry[]);
      }
    }
  }

  async function saveLocationCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCapture || !supabase || correctionReason.trim().length < 3 || !correctedLocation.trim()) return;
    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    const { error } = await supabase.rpc('admin_correct_capture_location', {
      p_capture_request_id: selectedCapture.id, p_location: correctedLocation.trim(), p_reason: correctionReason.trim(),
    });
    setActionBusy(false);
    if (error) setActionError('The location could not be corrected. Check the reason and try again.');
    else {
      setActionMessage('The location was corrected and added as a new history entry.');
      await loadCaptures(appliedFilters);
      setCorrectionReason('');
      if (supabase) {
        const { data } = await supabase.from('admin_audit_log').select('id,action,admin_user_id,created_at,target_record_type,target_record_id,previous_value,new_value,reason').eq('target_capture_request_id', selectedCapture.id).order('created_at', { ascending: false }).limit(100);
        setAuditEntries((data ?? []) as AuditEntry[]);
      }
      const updatedCapture = { ...selectedCapture, extracted_payload: { ...selectedCapture.extracted_payload, location: correctedLocation.trim() } };
      const updatedDetails = await getRecordDetails(updatedCapture, householdName);
      setRecordDetails(updatedDetails);
    }
  }

  if (adminRoleLoading) return <PageLayout title="Family Activity" backTo="/"><p className="empty-state">Checking administrator access…</p></PageLayout>;
  if (!isGlobalAdmin) return <PageLayout title="Family Activity" backTo="/"><StatusMessage tone="error">This page is available only to the provisioned family administrator.</StatusMessage></PageLayout>;
  if (!supabase) return <PageLayout title="Family Activity" backTo="/"><StatusMessage tone="neutral">Connect Gurtu to review family activity.</StatusMessage></PageLayout>;
  if (!aal2) return <PageLayout title="Family Activity" backTo="/"><MfaGate onReady={() => setAal2(true)} /></PageLayout>;

  return (
    <PageLayout title="Family Activity" backTo="/">
      <section className="page-section family-activity" aria-labelledby="activity-heading">
        <div className="section-heading-row"><div><h3 id="activity-heading">Review Remember something activity</h3><p className="section-lead">Review action status, saved records and recovery history. Personal transcript text stays visible only to its sender.</p></div><Link className="quiet-link" to="/">Home</Link></div>
        <form className="admin-filters" onSubmit={(event) => void applyFilters(event)}>
          <label className="admin-filter admin-filter--search" htmlFor="activity-search">Search action details<input id="activity-search" className="text-field" type="search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search family activity" /></label>
          <label className="admin-filter" htmlFor="activity-household">Household<select id="activity-household" className="text-field" value={filters.household} onChange={(event) => setFilters({ ...filters, household: event.target.value })}><option value="">All households</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label>
          <label className="admin-filter" htmlFor="activity-account">Account<select id="activity-account" className="text-field" value={filters.account} onChange={(event) => setFilters({ ...filters, account: event.target.value })}><option value="">All accounts</option>{profiles.map((profile) => <option key={profile.user_id} value={profile.user_id}>{profile.display_name}</option>)}</select></label>
          <label className="admin-filter" htmlFor="activity-person">Tagged person<select id="activity-person" className="text-field" value={filters.person} onChange={(event) => setFilters({ ...filters, person: event.target.value })}><option value="">All people</option>{people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label>
          <label className="admin-filter" htmlFor="activity-from">Date from<input id="activity-from" className="text-field" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label className="admin-filter" htmlFor="activity-to">Date to<input id="activity-to" className="text-field" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <label className="admin-filter" htmlFor="activity-operation">Operation<select id="activity-operation" className="text-field" value={filters.intent} onChange={(event) => setFilters({ ...filters, intent: event.target.value })}><option value="">All operations</option>{Object.entries(INTENT_LABEL).map(([intent, label]) => <option key={intent} value={intent}>{label}</option>)}</select></label>
          <label className="admin-filter" htmlFor="activity-status">Status<select id="activity-status" className="text-field" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
          <button className="button button--primary admin-filter-submit" type="submit" disabled={loading}>Apply filters</button>
        </form>
        {loadError ? <StatusMessage tone="error">{loadError}</StatusMessage> : null}
        {actionMessage ? <StatusMessage tone="success">{actionMessage}</StatusMessage> : null}
        {loading ? <p className="muted-copy">Loading family activity…</p> : null}
        {!loading && !loadError && captures.length === 0 ? <p className="empty-state">No matching activity was found.</p> : null}
        {!loading && !loadError && captures.length > 0 ? <div className="admin-review-layout">
          <ol className="admin-capture-list" aria-label="Chronological family activity">
            {captures.map((capture) => <li key={capture.id}>
              <button className={`admin-capture-row${selectedId === capture.id ? ' is-selected' : ''}`} type="button" aria-pressed={selectedId === capture.id} onClick={() => setSelectedId(capture.id)}>
                <span className="admin-capture-row__top"><strong>{capture.detected_intent ? INTENT_LABEL[capture.detected_intent] : capture.input_type === 'voice' ? 'Voice capture' : 'Text capture'}</strong><span className={`admin-status admin-status--${capture.processing_status}`}>{STATUS_LABEL[capture.processing_status]}</span></span>
                <span className="admin-capture-row__preview">{capture.safe_error_description || (capture.detected_intent ? 'Saved action details are available.' : 'Private request text is visible only to its sender.')}</span>
                <span className="admin-capture-row__meta">{profileName.get(capture.submitted_by_user_id) ?? 'Family account'} · {householdName.get(capture.household_id) ?? 'Household'} · {formatDate(capture.created_at)}</span>
              </button>
            </li>)}
          </ol>
          <section className="admin-capture-detail" aria-label="Selected activity details">
            {!selectedCapture ? <p className="empty-state">Select an activity to review its details.</p> : <>
              <div className="admin-detail-heading"><div><span className={`admin-status admin-status--${selectedCapture.processing_status}`}>{STATUS_LABEL[selectedCapture.processing_status]}</span><h3>{selectedCapture.detected_intent ? INTENT_LABEL[selectedCapture.detected_intent] : 'Remember something request'}</h3></div><time>{formatDate(selectedCapture.created_at)}</time></div>
              <dl className="admin-capture-meta"><div><dt>Account</dt><dd>{profileName.get(selectedCapture.submitted_by_user_id) ?? 'Family account'}</dd></div><div><dt>Household</dt><dd>{householdName.get(selectedCapture.household_id) ?? 'Household'}</dd></div><div><dt>Input type</dt><dd>{selectedCapture.input_type === 'voice' ? 'Voice' : 'Typed text'}</dd></div><div><dt>Language</dt><dd>{selectedCapture.detected_language}</dd></div></dl>
              <section className="admin-detail-block"><h4>Message privacy</h4><p className="muted-copy">Original and corrected words are private to the person who sent them.</p></section>
              <section className="admin-detail-block"><h4>Structured action</h4>{selectedCapture.extracted_payload && Object.keys(selectedCapture.extracted_payload).length ? <pre className="admin-json">{JSON.stringify(selectedCapture.extracted_payload, null, 2)}</pre> : <p className="muted-copy">No shared action details were saved.</p>}<p className="admin-tags"><strong>People tagged:</strong> {selectedNames(selectedCapture.selected_person_ids ?? [], people).join(', ') || 'None'}</p></section>
              {selectedCapture.safe_error_description ? <section className="admin-detail-block"><h4>Save result</h4><p>{selectedCapture.safe_error_description}</p>{selectedCapture.error_code ? <p className="admin-error-code">{selectedCapture.error_code}</p> : null}</section> : null}
              {detailLoading ? <p className="muted-copy">Loading saved record…</p> : null}
              {detailError ? <StatusMessage tone="error">{detailError}</StatusMessage> : null}
              {recordDetails ? <section className="admin-detail-block"><h4>Database result</h4><strong>{recordDetails.heading}</strong>{recordDetails.facts.map((fact) => <p className="admin-record-fact" key={fact}>{fact}</p>)}<p className="admin-tags"><strong>People associations:</strong> {recordDetails.people.join(', ') || 'None'}</p>{recordDetails.sourceMemory ? <p className="admin-transcript admin-source-memory"><strong>Source memory</strong><br />{recordDetails.sourceMemory}</p> : null}{recordDetails.listItems?.length ? <ul>{recordDetails.listItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : null}{recordDetails.locations?.length ? <ul className="admin-location-history">{recordDetails.locations.map((location, index) => <li key={`${location.created_at}-${index}`}><strong>{location.location_text}</strong><span>{formatDate(location.created_at)}{location.corrected_by_admin_user_id ? ' · corrected by administrator' : ''}</span>{location.correction_reason ? <small>Reason: {location.correction_reason}</small> : null}</li>)}</ul> : null}</section> : null}
              {['operation_failed', 'operation_pending'].includes(selectedCapture.processing_status) && ['save_memory', 'save_item_location', 'create_list'].includes(selectedCapture.detected_intent ?? '') ? <button className="button button--primary" type="button" onClick={() => void retryCapture()} disabled={actionBusy}>{actionBusy ? 'Retrying…' : selectedCapture.processing_status === 'operation_pending' ? 'Resume saved action' : 'Retry saved action'}</button> : null}
              {selectedCapture.detected_intent && selectedCapture.detected_intent !== 'clarify' ? <form className="admin-correction-form" onSubmit={(event) => void savePeopleCorrection(event)}><h4>Correct people tags</h4><fieldset className="admin-person-options"><legend>People associated with this request</legend>{people.map((person) => <label key={person.id}><input type="checkbox" checked={correctionPeople.includes(person.id)} onChange={(event) => setCorrectionPeople(event.target.checked ? [...correctionPeople, person.id] : correctionPeople.filter((id) => id !== person.id))} />{person.display_name}</label>)}</fieldset><label className="field-label" htmlFor="people-correction-reason">Reason for correction</label><textarea id="people-correction-reason" className="text-area" rows={2} minLength={3} maxLength={500} required value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /><button className="button button--secondary" type="submit" disabled={actionBusy || correctionReason.trim().length < 3}>{actionBusy ? 'Saving…' : 'Save people correction'}</button></form> : null}
              {selectedCapture.detected_intent === 'save_item_location' ? <form className="admin-correction-form" onSubmit={(event) => void saveLocationCorrection(event)}><h4>Correct structured location</h4><label className="field-label" htmlFor="corrected-location">Location</label><input id="corrected-location" className="text-field" maxLength={500} required value={correctedLocation} onChange={(event) => setCorrectedLocation(event.target.value)} /><label className="field-label" htmlFor="location-correction-reason">Reason for correction</label><textarea id="location-correction-reason" className="text-area" rows={2} minLength={3} maxLength={500} required value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /><button className="button button--secondary" type="submit" disabled={actionBusy || correctionReason.trim().length < 3 || !correctedLocation.trim()}>{actionBusy ? 'Saving…' : 'Save location correction'}</button></form> : null}
              {actionError ? <StatusMessage tone="error">{actionError}</StatusMessage> : null}
              <section className="admin-detail-block admin-audit"><h4>Administrator audit trail</h4>{auditEntries.length ? <ol>{auditEntries.map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll('_', ' ')}</strong><time>{formatDate(entry.created_at)}</time>{entry.reason ? <p>{entry.reason}</p> : null}{entry.previous_value !== null ? <details><summary>Change details</summary><pre>{JSON.stringify({ previous: entry.previous_value, updated: entry.new_value }, null, 2)}</pre></details> : null}</li>)}</ol> : <p className="muted-copy">No earlier administrative actions.</p>}</section>
            </>}
          </section>
        </div> : null}
      </section>
    </PageLayout>
  );
}
