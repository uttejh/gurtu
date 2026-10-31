import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PaperPlaneRight } from '@phosphor-icons/react';
import { Temporal } from '@js-temporal/polyfill';
import { PageLayout } from '../../components/PageLayout';
import { VoiceRecorder } from '../../components/VoiceRecorder';
import { StatusMessage } from '../../components/StatusMessage';
import { useAuth } from '../../app/useAuth';
import { useFamilyPeople } from '../shared/useFamilyPeople';
import { ActionProposalSchema } from '../../lib/actions';
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
}

function isQuestion(value: string): boolean {
  return /\?|\b(where|when|who|what|why|how|which)\b/iu.test(value.trim()) || /(ఎక్కడ|ఎప్పుడు|ఎవరు|ఏమిటి|ఏమి|ఎలా|ఎవరి)/u.test(value);
}

function eventDate(value: string): string {
  return Temporal.PlainDate.from(value).toLocaleString('en', { dateStyle: 'long' });
}

function eventZoneLabel(zone: string): string {
  if (zone === 'Asia/Kolkata') return 'India time';
  if (zone === 'America/Toronto') return 'Toronto time';
  return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortGeneric' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? zone;
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

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setHistoryLoading(false);
      return;
    }
    let active = true;
    void supabase.from('talk_messages').select('id,role,content,result_type,result_id,sources,created_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: true }).limit(300)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError('We could not load your conversation. Please refresh and try again.');
        else setMessages((data ?? []) as TalkMessage[]);
        setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  async function saveMessage(message: Omit<TalkMessage, 'id'>): Promise<TalkMessage> {
    const fallback: TalkMessage = { ...message, id: crypto.randomUUID() };
    if (!supabase) return fallback;
    const { data, error: saveError } = await supabase.from('talk_messages').insert({
      user_id: session?.user.id,
      role: message.role,
      content: message.content,
      result_type: message.result_type ?? null,
      result_id: message.result_id ?? null,
      sources: message.sources ?? [],
    }).select('id,role,content,result_type,result_id,sources').single();
    if (saveError) setError('This conversation could not be saved. Your family records are still private and unchanged.');
    return saveError || !data ? fallback : data as TalkMessage;
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
    const response = await saveMessage({ role: 'assistant', content: successContent || result.message || 'Saved to your family memory.', result_type: resultType, result_id: result.result_entity_id });
    setMessages((current) => [...current, response]);
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
      const response = await saveMessage({ role: 'assistant', content: proposal.question });
      setMessages((current) => [...current, response]);
      return;
    }
    if (proposal.action === 'remove_list_item') {
      setPending({ requestId, personIds: peopleMentioned, input, originalInput, inputType: sourceType });
      const response = await saveMessage({ role: 'assistant', content: `Do you want me to remove “${proposal.item_text}” from ${proposal.list_title}?` });
      setMessages((current) => [...current, response]);
      return;
    }
    const successContent = proposal.action === 'create_event'
      ? `${proposal.title} · ${eventDate(proposal.local_date)}${proposal.all_day ? ' · All day' : ` · ${proposal.local_time} · ${eventZoneLabel(proposal.time_zone)}`}. Saved to your family memories and calendar.`
      : undefined;
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
    const userMessage = await saveMessage({ role: 'user', content: value });
    setMessages((current) => [...current, userMessage]);
    const requestId = inputType === 'voice' && voiceRequestId ? voiceRequestId : crypto.randomUUID();
    let retryPhase: RetryRequest['phase'] = 'ask';
    let retrySuccessContent: string | undefined;
    const sourceType = inputType;
    const originalInput = sourceType === 'voice' ? voiceOriginalText || value : value;
    const peopleMentioned = findPeopleMentioned(value, identities()).map((person) => person.id);
    try {
      if (isQuestion(value)) {
        const { data, error: askError } = await supabase.functions.invoke('ask-memory', { body: { question: value } });
        if (askError || typeof data?.answer !== 'string') throw askError ?? new Error('No answer was returned.');
        const answer = await saveMessage({
          role: 'assistant', content: data.answer, result_type: 'answer',
          sources: Array.isArray(data.sources) ? data.sources : [],
        });
        setMessages((current) => [...current, answer]);
      } else {
        retryPhase = 'interpret';
        await runAction(value, requestId, originalInput, sourceType, (phase, successContent) => { retryPhase = phase; retrySuccessContent = successContent; });
      }
      setInputType('text');
      setVoiceOriginalText('');
      setVoiceRequestId(null);
      setRetryRequest(null);
    } catch (cause) {
      setRetryRequest({ requestId, input: value, originalInput, inputType: sourceType, personIds: peopleMentioned, mode: isQuestion(value) ? 'ask' : 'action', phase: retryPhase, successContent: retrySuccessContent });
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
        const { data, error: askError } = await supabase.functions.invoke('ask-memory', { body: { question: request.input } });
        if (askError || typeof data?.answer !== 'string') throw askError ?? new Error('No answer was returned.');
        const answer = await saveMessage({ role: 'assistant', content: data.answer, result_type: 'answer', sources: Array.isArray(data.sources) ? data.sources : [] });
        setMessages((current) => [...current, answer]);
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
      const response = await saveMessage({ role: 'assistant', content: data.message || 'The list was updated.', result_type: 'list', result_id: data.result_entity_id });
      setMessages((current) => [...current, response]);
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
