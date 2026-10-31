import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PaperPlaneRight } from '@phosphor-icons/react';
import { Temporal } from '@js-temporal/polyfill';
import { PageLayout } from '../../components/PageLayout';
import { VoiceRecorder } from '../../components/VoiceRecorder';
import { StatusMessage } from '../../components/StatusMessage';
import { useAuth } from '../../app/useAuth';
import { useFamilyPeople } from '../shared/useFamilyPeople';
import { ActionProposalSchema, type ActionProposal } from '../../lib/actions';
import { findPeopleMentioned, type PersonIdentity } from '../../lib/people';
import { friendlyFunctionError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

interface TalkMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result_type?: 'memory' | 'list' | 'event' | 'answer' | null;
  result_id?: string | null;
  sources?: Array<{ id: string; original_text: string; created_at: string; kind?: string }>;
  created_at?: string;
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface PendingConfirmation {
  requestId: string;
  personIds: string[];
  input: string;
  originalInput: string;
  inputType: 'text' | 'voice';
}

interface RetryRequest {
  requestId: string;
  input: string;
  originalInput: string;
  inputType: 'text' | 'voice';
  personIds: string[];
  mode: 'ask' | 'action';
  phase: 'ask' | 'interpret' | 'execute';
  successContent?: string;
  conversationContext?: ConversationTurn[];
}

function isQuestion(value: string): boolean {
  return /\?|\b(where|when|who|what|why|how|which)\b/iu.test(value.trim())
    || /(ఎక్కడ(?:ికి|ినుంచి)?|ఎప్పుడు|ఎవరు|ఏమిటి|ఏమి|ఏంటి|ఎలా|ఎవరి|ఎవరికి|ఎందుకు|ఎంత|ఏది|ఏవి|ఉందా|వుందా|తెలుసా|చెప్పగలవా|చెప్పగలరా)(?:[.!?\s]|$)/u.test(value);
}

function eventDate(value: string): string {
  return Temporal.PlainDate.from(value).toLocaleString('en', { dateStyle: 'long' });
}

function eventZoneLabel(zone: string): string {
  if (zone === 'Asia/Kolkata') return 'India time';
  if (zone === 'America/Toronto') return 'Toronto time';
  return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortGeneric' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

function successMessage(input: string, proposal: ActionProposal): string | undefined {
  const isTelugu = /[\u0C00-\u0C7F]/u.test(input);
  if (proposal.action === 'create_event') {
    const date = isTelugu
      ? Temporal.PlainDate.from(proposal.local_date).toLocaleString('te-IN', { dateStyle: 'long' })
      : eventDate(proposal.local_date);
    if (isTelugu) {
      const time = proposal.all_day ? '' : `, ${proposal.local_time}`;
      return `సరే — ${date}న ${proposal.title} ఈవెంట్‌ను కుటుంబ క్యాలెండర్‌లో చేర్చాను${time}.`;
    }
    const time = proposal.all_day ? '' : ` at ${proposal.local_time} ${eventZoneLabel(proposal.time_zone)}`;
    return `Got it — ${proposal.title} is on ${date}${time}, and I added it to the family calendar.`;
  }
  if (!isTelugu) return undefined;
  switch (proposal.action) {
    case 'save_memory': return 'సరే — దీన్ని మీ కుటుంబ జ్ఞాపకాల్లో భద్రపరిచాను.';
    case 'save_item_location': return `${proposal.item_name} చివరిగా ${proposal.location}లో ఉందని గుర్తుంచుకున్నాను.`;
    case 'create_list': return `సరే — “${proposal.title}” జాబితాను సృష్టించాను.`;
    case 'add_list_items': return `సరే — ${proposal.list_title} జాబితాకు చేర్చాను.`;
    case 'update_list_item': return `సరే — ${proposal.list_title} జాబితాను నవీకరించాను.`;
    case 'remove_list_item': return undefined;
    case 'update_event': return `సరే — ${proposal.event_title} ఈవెంట్‌ను నవీకరించాను.`;
    case 'clarify': return undefined;
  }
}

function removalQuestion(input: string, item: string, list: string): string {
  return /[\u0C00-\u0C7F]/u.test(input)
    ? `“${item}”ను ${list} జాబితా నుంచి తీసివేయాలా?`
    : `Would you like me to remove “${item}” from ${list}?`;
}

export function TalkPage() {
  const { session } = useAuth();
  const { people } = useFamilyPeople();
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [text, setText] = useState('');
  const [inputType, setInputType] = useState<'text' | 'voice'>('text');
  const [voiceOriginalText, setVoiceOriginalText] = useState('');
  const [voiceRequestId, setVoiceRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(Boolean(supabase));
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messageWritesRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setHistoryLoading(false);
      return;
    }
    let active = true;
    void supabase.from('talk_messages').select('id,role,content,result_type,result_id,sources,created_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError('We could not load your conversation. Please refresh and try again.');
        else {
          const recent = ((data ?? []) as TalkMessage[]).reverse();
          setMessages((current) => {
            const persistedIds = new Set(recent.map((message) => message.id));
            return [...recent, ...current.filter((message) => !persistedIds.has(message.id))];
          });
        }
        setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  function saveMessage(message: Omit<TalkMessage, 'id'>): TalkMessage {
    const optimistic: TalkMessage = { ...message, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    if (!supabase || !session?.user.id) return optimistic;

    const client = supabase;
    const userId = session.user.id;
    const write = messageWritesRef.current.then(async () => {
      const { error: saveError } = await client.from('talk_messages').insert({
        id: optimistic.id,
        user_id: userId,
        role: optimistic.role,
        content: optimistic.content,
        result_type: optimistic.result_type ?? null,
        result_id: optimistic.result_id ?? null,
        sources: optimistic.sources ?? [],
      });
      if (saveError) throw saveError;
    });
    messageWritesRef.current = write.catch(() => {
      setError('This conversation could not be saved. Your family records are still private and unchanged.');
    });
    return optimistic;
  }

  function identities(): PersonIdentity[] {
    return people.map((person) => ({ id: person.id, displayName: person.display_name, aliases: person.aliases }));
  }

  async function executeAction(requestId: string, personIds: string[], successContent?: string) {
    if (!supabase) throw new Error('Gurtu is not connected yet.');
    const { data: result, error: executeError } = await supabase.functions.invoke('process-memory-input', {
      body: { mode: 'execute', request_id: requestId, person_ids: personIds, confirmed: true },
    });
    if (executeError || result?.ok !== true) throw executeError ?? new Error('That change could not be saved. Please try again.');
    const resultType = result.result_entity_type === 'event' ? 'event' : result.result_entity_type === 'list' ? 'list' : 'memory';
    saveMessage({ role: 'assistant', content: successContent || result.message || 'Saved to your family memory.', result_type: resultType, result_id: result.result_entity_id });
    setPending(null);
    setRetryRequest(null);
  }

  async function runAction(
    input: string,
    requestId: string,
    originalInput = input,
    sourceType: 'text' | 'voice' = inputType,
    onPhase?: (phase: 'interpret' | 'execute', successContent?: string) => void,
  ) {
    if (!supabase) throw new Error('Gurtu is not connected yet. Your message was not saved.');
    const peopleMentioned = findPeopleMentioned(input, identities()).map((person) => person.id);
    onPhase?.('interpret');
    const { data, error: invokeError } = await supabase.functions.invoke('process-memory-input', {
      body: { mode: 'interpret', input_type: sourceType, original_text: originalInput, corrected_text: input, request_id: requestId },
    });
    if (invokeError) throw invokeError;
    const parsed = ActionProposalSchema.safeParse(data?.proposal);
    if (!parsed.success) throw new Error('Gurtu could not prepare that action. Please try saying it another way.');
    const proposal = parsed.data;
    if (proposal.action === 'clarify') {
      saveMessage({ role: 'assistant', content: proposal.question });
      return;
    }
    if (proposal.action === 'remove_list_item') {
      setPending({ requestId, personIds: peopleMentioned, input, originalInput, inputType: sourceType });
      saveMessage({ role: 'assistant', content: removalQuestion(input, proposal.item_text, proposal.list_title) });
      return;
    }
    const successContent = successMessage(input, proposal);
    onPhase?.('execute', successContent);
    await executeAction(requestId, peopleMentioned, successContent);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    if (!supabase || !session?.user.id) {
      setError('Gurtu is not connected yet. Your message was not sent.');
      return;
    }
    setBusy(true);
    setError(null);
    setRetryRequest(null);
    setText('');
    const conversationContext = messages.slice(-4).map(({ role, content }) => ({ role, content: [...content].slice(0, 300).join('') }));
    saveMessage({ role: 'user', content: value });
    const requestId = inputType === 'voice' && voiceRequestId ? voiceRequestId : crypto.randomUUID();
    let retryPhase: RetryRequest['phase'] = 'ask';
    let retrySuccessContent: string | undefined;
    const sourceType = inputType;
    const originalInput = sourceType === 'voice' ? voiceOriginalText || value : value;
    const peopleMentioned = findPeopleMentioned(value, identities()).map((person) => person.id);
    try {
      if (isQuestion(value)) {
        const { data, error: askError } = await supabase.functions.invoke('ask-memory', { body: { question: value, conversation_context: conversationContext } });
        if (askError || typeof data?.answer !== 'string') throw askError ?? new Error('No answer was returned.');
        saveMessage({
          role: 'assistant', content: data.answer, result_type: 'answer',
          sources: Array.isArray(data.sources) ? data.sources : [],
        });
      } else {
        retryPhase = 'interpret';
        await runAction(value, requestId, originalInput, sourceType, (phase, successContent) => { retryPhase = phase; retrySuccessContent = successContent; });
      }
      setInputType('text');
      setVoiceOriginalText('');
      setVoiceRequestId(null);
      setRetryRequest(null);
    } catch (cause) {
      setRetryRequest({ requestId, input: value, originalInput, inputType: sourceType, personIds: peopleMentioned, mode: isQuestion(value) ? 'ask' : 'action', phase: retryPhase, successContent: retrySuccessContent, conversationContext });
      setError(await friendlyFunctionError(cause, 'We could not complete that. Your original words are still in the conversation. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function retryFailedMessage() {
    if (!retryRequest || !supabase || busy) return;
    const request = retryRequest;
    setBusy(true);
    setError(null);
    try {
      if (request.mode === 'ask') {
        const { data, error: askError } = await supabase.functions.invoke('ask-memory', { body: { question: request.input, conversation_context: request.conversationContext ?? [] } });
        if (askError || typeof data?.answer !== 'string') throw askError ?? new Error('No answer was returned.');
        saveMessage({ role: 'assistant', content: data.answer, result_type: 'answer', sources: Array.isArray(data.sources) ? data.sources : [] });
      } else if (request.phase === 'execute') {
        await executeAction(request.requestId, request.personIds, request.successContent);
      } else {
        await runAction(request.input, request.requestId, request.originalInput, request.inputType, (phase, successContent) => {
          setRetryRequest({ ...request, phase, successContent });
        });
      }
      setRetryRequest(null);
      setError(null);
      setInputType('text');
      setVoiceOriginalText('');
      setVoiceRequestId(null);
    } catch (cause) {
      setError(await friendlyFunctionError(cause, 'The retry did not complete. Your original message is still here. Please try again.'));
    } finally { setBusy(false); }
  }

  async function confirmRemoval() {
    if (!pending || !supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('process-memory-input', {
        body: { mode: 'execute', request_id: pending.requestId, person_ids: pending.personIds, confirmed: true },
      });
      if (invokeError || data?.ok !== true) throw invokeError ?? new Error('The item could not be removed.');
      const responseText = /[\u0C00-\u0C7F]/u.test(pending.input) ? 'సరే — ఆ అంశాన్ని జాబితా నుంచి తీసివేశాను.' : data.message || 'The list was updated.';
      saveMessage({ role: 'assistant', content: responseText, result_type: 'list', result_id: data.result_entity_id });
      setPending(null);
      setRetryRequest(null);
    } catch (cause) {
      setRetryRequest({ ...pending, mode: 'action', phase: 'execute' });
      setError(await friendlyFunctionError(cause, 'That item could not be removed. Please try again.'));
    } finally { setBusy(false); }
  }

  return (
    <PageLayout title="Talk to Gurtu" backTo="/">
      <section className="talk-section" aria-label="Conversation with Gurtu">
        <p className="section-lead">Tell me something, ask a question, update a list or add an event.</p>
        <p className="talk-privacy-note">Your conversation is private to you. Anything you save becomes part of your family records.</p>
        <div className="talk-messages" aria-live="polite">
          {historyLoading ? <p className="muted-copy">Loading your conversation…</p> : null}
          {!historyLoading && messages.length === 0 ? <p className="talk-empty">Start by speaking or typing to Gurtu.</p> : null}
          {messages.map((message) => (
            <article className={`talk-message talk-message--${message.role}`} key={message.id}>
              <p>{message.content}</p>
              {message.result_type === 'event' && message.result_id ? <Link className="quiet-link" to={`/calendar?edit=${encodeURIComponent(message.result_id)}`}>Edit event</Link> : null}
              {message.result_type === 'list' && message.result_id ? <Link className="quiet-link" to="/lists">View lists</Link> : null}
              {message.sources?.length ? <div className="talk-sources"><span>From what your family saved</span>{message.sources.map((source) => <blockquote key={source.id}><p>{source.original_text}</p><time>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(source.created_at))}</time></blockquote>)}</div> : null}
              {pending && message.role === 'assistant' && message.content.startsWith('Do you want me to remove') ? <div className="form-actions"><button type="button" className="button button--primary" onClick={() => void confirmRemoval()} disabled={busy}>Yes, remove it</button><button type="button" className="button button--secondary" onClick={() => setPending(null)} disabled={busy}>Keep it</button></div> : null}
            </article>
          ))}
          {busy ? <p className="talk-thinking">Gurtu is thinking…</p> : null}
          <div ref={endRef} />
        </div>
        {error ? <div className="talk-error"><StatusMessage tone="error">{error}</StatusMessage>{retryRequest ? <button className="button button--secondary talk-retry" type="button" onClick={() => void retryFailedMessage()} disabled={busy}>{busy ? 'Trying again…' : 'Try again'}</button> : null}</div> : null}
        <form className="talk-composer" onSubmit={(event) => void send(event)}>
          <VoiceRecorder onTranscript={(transcript, requestId) => { setText(transcript); setVoiceOriginalText(transcript); setVoiceRequestId(requestId); setInputType('voice'); setError(null); }} />
          <textarea className="text-area talk-input" aria-label="Message to Gurtu" rows={2} maxLength={8000} placeholder="Type in Telugu or English…" value={text} onChange={(event) => { setText(event.target.value); if (inputType !== 'voice') setInputType('text'); }} />
          <button className="button button--primary talk-send" type="submit" disabled={busy || !text.trim()}><PaperPlaneRight aria-hidden="true" /><span>Send</span></button>
        </form>
      </section>
    </PageLayout>
  );
}
