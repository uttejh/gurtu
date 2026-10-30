import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '../../components/PageLayout';
import { VoiceRecorder } from '../../components/VoiceRecorder';
import { PeoplePicker } from '../shared/PeoplePicker';
import { StatusMessage } from '../../components/StatusMessage';
import { useFamilyPeople } from '../shared/useFamilyPeople';
import { ActionProposalSchema, type ActionProposal } from '../../lib/actions';
import { findPeopleMentioned, type PersonIdentity } from '../../lib/people';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

function proposalHeading(proposal: ActionProposal): string {
  switch (proposal.action) {
    case 'save_memory': return 'Save this family memory';
    case 'save_item_location': return `Remember where ${proposal.item_name} was last reported`;
    case 'create_list': return `Create ${proposal.title}`;
    case 'add_list_items': return `Add items to ${proposal.list_title}`;
    case 'update_list_item': return `${proposal.completed ? 'Mark as complete' : 'Unmark'} ${proposal.item_text}`;
    case 'remove_list_item': return `Remove ${proposal.item_text} from ${proposal.list_title}`;
    case 'create_event': return `Add ${proposal.title} to the calendar`;
    case 'update_event': return `Update ${proposal.event_title}`;
    case 'clarify': return proposal.question;
  }
}

function proposalDetails(proposal: ActionProposal): string[] {
  switch (proposal.action) {
    case 'save_memory': return [proposal.original_text];
    case 'save_item_location': return [proposal.original_text, `${proposal.item_name} · ${proposal.location}`];
    case 'create_list': return [proposal.items.length ? proposal.items.join(' · ') : 'This list will start empty.'];
    case 'add_list_items': return [proposal.items.join(' · ')];
    case 'update_list_item': return [proposal.list_title];
    case 'remove_list_item': return [proposal.list_title];
    case 'create_event': return [
      proposal.all_day ? `${proposal.local_date} · All day` : `${proposal.local_date} · ${proposal.local_time} · ${proposal.time_zone}`,
      proposal.end_time_assumed ? 'The end time will be set to one hour after the start.' : '',
    ].filter(Boolean);
    case 'update_event': return [proposal.all_day ? `${proposal.local_date} · All day` : `${proposal.local_date} · ${proposal.local_time} · ${proposal.time_zone}`];
    case 'clarify': return [];
  }
}

function selectedPeopleFromProposal(proposal: ActionProposal, text: string, people: ReturnType<typeof useFamilyPeople>['people']): string[] {
  const mentions = 'people_mentions' in proposal ? proposal.people_mentions : [];
  const identities: PersonIdentity[] = people.map((person) => ({
    id: person.id,
    displayName: person.display_name,
    aliases: person.aliases,
  }));
  const selected = new Set<string>();
  for (const mention of mentions) {
    const matches = findPeopleMentioned(mention, identities);
    if (matches.length === 1) selected.add(matches[0].id);
  }
  for (const person of findPeopleMentioned(text, identities)) selected.add(person.id);
  return [...selected];
}

export function RememberPage() {
  const { people, loading: peopleLoading, failed: peopleFailed } = useFamilyPeople();
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<ActionProposal | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateText(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
    setProposal(null);
    setRequestId(null);
    setError(null);
    setSuccess(null);
  }

  async function interpretText() {
    const correctedText = text.trim();
    if (!correctedText) {
      setError('Type or speak something you would like your family to remember.');
      return;
    }
    if (!supabase) {
      setError('Gurtu is not connected yet. Your information was not saved.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    const idempotencyKey = crypto.randomUUID();
    try {
      const { data, error: functionError } = await supabase.functions.invoke('process-memory-input', {
        body: { mode: 'interpret', original_text: correctedText, request_id: idempotencyKey },
      });
      if (functionError) throw functionError;
      const parsed = ActionProposalSchema.safeParse(data?.proposal);
      if (!parsed.success) throw new Error('The saved action could not be confirmed.');
      setProposal(parsed.data);
      setRequestId(idempotencyKey);
      setSelectedPeople(selectedPeopleFromProposal(parsed.data, correctedText, people));
    } catch (cause) {
      setError(friendlyError(cause, 'We could not understand that. Your information was not saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (!proposal || !requestId || proposal.action === 'clarify' || !supabase) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('process-memory-input', {
        body: {
          mode: 'execute',
          original_text: text.trim(),
          request_id: requestId,
          proposal,
          person_ids: selectedPeople,
          confirmed: true,
        },
      });
      if (functionError || data?.ok !== true) throw functionError ?? new Error('The save did not complete.');
      setSuccess(data.message || 'Saved to your family memory.');
      setProposal(null);
      setRequestId(null);
    } catch (cause) {
      setError(friendlyError(cause, "Your information wasn't saved. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout title="Remember something" backTo="/">
      <section className="page-section remember-section" aria-labelledby="remember-instruction">
        <h3 id="remember-instruction" className="section-lead">Speak or type what you want your family to remember.</h3>
        <VoiceRecorder onTranscript={(transcript) => {
          setText(transcript);
          setProposal(null);
          setRequestId(null);
          setError(null);
          setSuccess(null);
        }} />
        <label className="field-label" htmlFor="remember-text">Or type here</label>
        <textarea
          id="remember-text"
          className="text-area"
          rows={5}
          maxLength={8000}
          placeholder="For example: నా పాస్‌బుక్ కారులో పెట్టాను."
          value={text}
          onChange={updateText}
          lang="te"
        />
        <div className="form-actions">
          <button className="button button--primary" type="button" onClick={interpretText} disabled={busy || !text.trim()}>
            {busy ? 'Please wait…' : proposal ? 'Review again' : 'Continue'}
          </button>
        </div>
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
        {peopleFailed ? <StatusMessage tone="error">We could not load family names. You can still save without a tag.</StatusMessage> : null}

        {proposal && proposal.action !== 'clarify' ? (
          <section className="confirmation-panel" aria-labelledby="confirm-action-heading">
            <h3 id="confirm-action-heading">{proposalHeading(proposal)}</h3>
            {proposalDetails(proposal).map((detail) => <p key={detail} className="confirmation-detail">{detail}</p>)}
            <PeoplePicker
              people={people}
              selectedIds={selectedPeople}
              onChange={setSelectedPeople}
              label={peopleLoading ? 'Loading family members…' : 'Tag family members (optional)'}
            />
            <div className="form-actions">
              <button className="button button--primary" type="button" onClick={confirmAction} disabled={busy}>
                {busy ? 'Saving…' : 'Confirm and save'}
              </button>
              <button className="button button--secondary" type="button" onClick={() => setProposal(null)} disabled={busy}>Edit words</button>
            </div>
          </section>
        ) : null}
        {proposal?.action === 'clarify' ? (
          <section className="confirmation-panel" aria-live="polite">
            <h3>{proposal.question}</h3>
            <button className="button button--secondary" type="button" onClick={() => setProposal(null)}>Edit words</button>
          </section>
        ) : null}
        {!supabase ? <StatusMessage tone="neutral">Your words stay on this page until Gurtu is connected. Nothing is saved yet.</StatusMessage> : null}
      </section>
      <p className="privacy-note">Your original words are kept as you said them.</p>
      <Link className="quiet-link" to="/memories">See saved memories</Link>
    </PageLayout>
  );
}
