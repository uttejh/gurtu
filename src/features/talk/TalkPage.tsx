import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PaperPlaneRight, Plus } from '@phosphor-icons/react';
import { PageLayout } from '../../components/PageLayout';
import { VoiceRecorder } from '../../components/VoiceRecorder';
import { StatusMessage } from '../../components/StatusMessage';
import { supabase } from '../../lib/supabase';
import {
  isOpenConfirmation, MESSAGE_COLUMNS, processMessage, sortMessages, TalkRequestError, unansweredMessage,
  type ConversationSummary, type ProcessResult, type TalkMessage,
} from '../../lib/talk';

interface SendPayload {
  conversationId: string | null;
  clientMessageId: string;
  text: string;
  inputType: 'text' | 'voice';
  originalText: string | null;
}

const SEND_FALLBACK = 'Gurtu could not finish that. Your words are saved. Please try again.';

function pendingId(clientMessageId: string) {
  return `pending-${clientMessageId}`;
}

function payloadFor(message: TalkMessage): SendPayload {
  return {
    conversationId: message.conversation_id,
    clientMessageId: message.client_message_id ?? message.id,
    text: message.content,
    inputType: message.input_type ?? 'text',
    originalText: typeof message.metadata?.original_text === 'string' ? message.metadata.original_text : null,
  };
}

export function TalkPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId && supabase));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<{ requestId: string; transcript: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedSend, setFailedSend] = useState<SendPayload | null>(null);
  const loadedConversationRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Load the chat named in the address, unless this page just created it.
  useEffect(() => {
    if (!conversationId) {
      if (loadedConversationRef.current !== null) {
        loadedConversationRef.current = null;
        setConversation(null);
        setMessages([]);
        setError(null);
        setFailedSend(null);
      }
      setLoading(false);
      setLoadError(null);
      return;
    }
    if (loadedConversationRef.current === conversationId || !supabase) return;
    const client = supabase;
    let active = true;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setFailedSend(null);
    setConversation(null);
    setMessages([]);
    void Promise.all([
      client.from('conversations').select('id,title,last_activity_at').eq('id', conversationId).maybeSingle(),
      client.from('talk_messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(200),
    ]).then(([conversationResult, messageResult]) => {
      if (!active) return;
      if (conversationResult.error || messageResult.error) {
        setLoadError('We could not load this chat. Please refresh and try again.');
      } else if (!conversationResult.data) {
        setLoadError('This chat could not be found. Start a new chat instead.');
      } else {
        loadedConversationRef.current = conversationId;
        setConversation(conversationResult.data as ConversationSummary);
        setMessages(sortMessages((messageResult.data ?? []) as unknown as TalkMessage[]));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const adoptConversation = useCallback((next: ConversationSummary) => {
    setConversation(next);
    if (loadedConversationRef.current !== next.id) {
      loadedConversationRef.current = next.id;
      navigate(`/talk/${next.id}`, { replace: true });
    }
  }, [navigate]);

  function applyResult(result: ProcessResult, replacing?: string) {
    setMessages((current) => {
      const incoming = [...(result.user_message ? [result.user_message] : []), result.reply];
      const ids = new Set(incoming.map((message) => message.id));
      return sortMessages([...current.filter((message) => message.id !== replacing && !ids.has(message.id)), ...incoming]);
    });
    adoptConversation(result.conversation);
  }

  async function submit(payload: SendPayload) {
    setBusy(true);
    setError(null);
    try {
      const result = await processMessage({
        action: 'send',
        conversation_id: payload.conversationId,
        client_message_id: payload.clientMessageId,
        text: payload.text,
        input_type: payload.inputType,
        original_text: payload.originalText,
      }, SEND_FALLBACK);
      applyResult(result, pendingId(payload.clientMessageId));
      setFailedSend(null);
    } catch (cause) {
      const failure = cause instanceof TalkRequestError ? cause : new TalkRequestError(SEND_FALLBACK);
      const savedIn = failure.conversationId ?? payload.conversationId;
      if (failure.conversationId && !conversation) {
        // The words were saved in a new chat even though Gurtu could not finish.
        adoptConversation({ id: failure.conversationId, title: 'New chat', last_activity_at: new Date().toISOString() });
        void supabase?.from('conversations').select('id,title,last_activity_at').eq('id', failure.conversationId).maybeSingle()
          .then(({ data }) => { if (data) setConversation(data as ConversationSummary); });
      }
      setFailedSend({ ...payload, conversationId: savedIn });
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    if (!supabase) {
      setError('Gurtu is not connected yet. Your message was not sent.');
      return;
    }
    const payload: SendPayload = {
      conversationId: conversation?.id ?? null,
      clientMessageId: voice?.requestId ?? crypto.randomUUID(),
      text: value,
      inputType: voice ? 'voice' : 'text',
      originalText: voice?.transcript ?? null,
    };
    setMessages((current) => [...current, {
      id: pendingId(payload.clientMessageId), conversation_id: conversation?.id ?? '', role: 'user', content: value,
      result_type: null, result_id: null, sources: [], created_at: new Date().toISOString(),
      client_message_id: payload.clientMessageId, reply_to_message_id: null, input_type: payload.inputType, metadata: {},
    }]);
    setText('');
    setVoice(null);
    void submit(payload);
  }

  async function answerConfirmation(message: TalkMessage, action: 'confirm' | 'cancel') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      applyResult(await processMessage({ action, conversation_id: message.conversation_id, confirmation_message_id: message.id },
        action === 'confirm' ? 'That change could not be saved. Please try again.' : 'Gurtu could not record that. Please try again.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That change could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const unanswered = unansweredMessage(messages);
  const retryPayload = failedSend ?? (unanswered ? payloadFor(unanswered) : null);
  const shownError = error ?? (unanswered && !busy ? 'Gurtu has not answered your last message yet.' : null);
  const title = conversation?.title ?? 'New chat';

  return (
    <PageLayout backTo="/" headerAction={conversation ? <Link className="quiet-link talk-new-chat" to="/talk"><Plus aria-hidden="true" /> New chat</Link> : null}>
      <h2 className="talk-title" title={title}>{title}</h2>
      <section className="talk-section" aria-label="Conversation with Gurtu">
        <p className="talk-privacy-note">This chat is private to your login. Useful facts from it, not the chat itself, are shared with your household so Gurtu can recall them in other chats.</p>
        <div className="talk-messages" aria-live="polite">
          {loading ? <p className="muted-copy">Loading your chat…</p> : null}
          {loadError ? <StatusMessage tone="error">{loadError}</StatusMessage> : null}
          {!loading && !loadError && messages.length === 0 ? <p className="talk-empty">Start by speaking or typing to Gurtu.</p> : null}
          {messages.map((message) => (
            <article className={`talk-message talk-message--${message.role}`} key={message.id}>
              <p>{message.content}</p>
              {message.result_type === 'event' && message.result_id ? <Link className="quiet-link" to={`/calendar?edit=${encodeURIComponent(message.result_id)}`}>Edit event</Link> : null}
              {message.result_type === 'list' && message.result_id ? <Link className="quiet-link" to="/lists">View lists</Link> : null}
              {message.sources?.length ? <div className="talk-sources"><span>From what your family saved</span>{message.sources.map((source) => <blockquote key={source.id}><p>{source.original_text}</p><time>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(source.created_at))}</time></blockquote>)}</div> : null}
              {isOpenConfirmation(message, messages) ? <div className="form-actions"><button type="button" className="button button--primary" onClick={() => void answerConfirmation(message, 'confirm')} disabled={busy}>Yes, proceed</button><button type="button" className="button button--secondary" onClick={() => void answerConfirmation(message, 'cancel')} disabled={busy}>Keep it</button></div> : null}
            </article>
          ))}
          {busy ? <p className="talk-thinking">Gurtu is thinking…</p> : null}
          <div ref={endRef} />
        </div>
        {shownError ? <div className="talk-error"><StatusMessage tone="error">{shownError}</StatusMessage>{retryPayload ? <button className="button button--secondary talk-retry" type="button" onClick={() => void submit(retryPayload)} disabled={busy}>{busy ? 'Trying again…' : 'Try again'}</button> : null}</div> : null}
        <form className="talk-composer" onSubmit={send}>
          <textarea className="text-area talk-input" aria-label="Message to Gurtu" rows={2} maxLength={8000} placeholder="Type in Telugu or English…" value={text} onChange={(event) => setText(event.target.value)} disabled={Boolean(loadError)} />
          <div className="talk-composer__actions">
            <VoiceRecorder compact conversationId={conversation?.id ?? null} onTranscript={(transcript, requestId) => { setText(transcript); setVoice({ requestId, transcript }); setError(null); }} />
            <button className="button button--primary talk-send" type="submit" disabled={busy || !text.trim() || Boolean(loadError)}><PaperPlaneRight aria-hidden="true" /><span>Send</span></button>
          </div>
        </form>
      </section>
    </PageLayout>
  );
}
