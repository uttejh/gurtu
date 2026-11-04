// One entry point for every chat message (Stage 1 of the master specification).
//
// Lifecycle for a sent message:
//   1. authenticate (withRequest) and validate the request
//   2. save the user's words first, keyed by client_message_id (idempotent)
//   3. if this message already has a reply, return it (safe retry)
//   4. load recent turns of this conversation from the database
//   5. answer a question, or interpret -> confirm/execute an action
//   6. save exactly one assistant reply and return it
// Confirm/cancel requests act on a saved confirmation question.
import { validateProposal, type ActionProposal } from '../_shared/actions.ts';
import { answerQuestion, type ConversationTurn } from '../_shared/ask.ts';
import { detectLanguage, executeCapture, interpretCapture, loadOwnCapture, type ExecuteResult } from '../_shared/capture.ts';
import { conversationTitle, parseMessageRequest, type MessageRequest } from '../_shared/conversation.ts';
import { HttpError, readJson, withRequest, type RequestContext } from '../_shared/http.ts';
import { isQuestion } from '../_shared/intent.ts';
import { processIndexJobs } from '../_shared/memory.ts';
import { normalizeAlias } from '../_shared/people.ts';
import { cancelledMessage, confirmedMessage, deleteEventQuestion, isTeluguText, removalQuestion, replaceVocabularyQuestion, successMessage, type ReplyProposal } from '../_shared/replies.ts';

const MESSAGE_COLUMNS = 'id,conversation_id,role,content,result_type,result_id,sources,created_at,client_message_id,reply_to_message_id,input_type,metadata';
const CONTEXT_TURNS = 12;
const RESUMABLE = ['awaiting_confirmation', 'operation_pending', 'operation_failed', 'succeeded'];

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** Runs summary and recall indexing after the response is sent. Failures stay queued for retry. */
function indexInBackground(context: RequestContext) {
  const work = processIndexJobs(context, 2).catch(() => undefined);
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
}

type ResultType = 'memory' | 'list' | 'event' | 'answer';
interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  result_type: ResultType | null;
  result_id: string | null;
  sources: unknown[];
  created_at: string;
  client_message_id: string | null;
  reply_to_message_id: string | null;
  input_type: 'text' | 'voice' | null;
  metadata: Record<string, unknown>;
}
interface Reply {
  content: string;
  result_type?: ResultType | null;
  result_id?: string | null;
  sources?: unknown[];
  metadata: Record<string, unknown>;
}

function timed<T>(operation: string, work: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  return work().finally(() => {
    console.info(JSON.stringify({ metric: 'process_message_stage', operation, duration_ms: Math.round(performance.now() - startedAt) }));
  });
}

async function loadMessage(context: RequestContext, id: string): Promise<MessageRow | null> {
  const { data, error } = await context.supabase.from('talk_messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new HttpError(503, 'Gurtu could not load this conversation right now. Please try again.');
  return (data ?? null) as MessageRow | null;
}

async function loadReply(context: RequestContext, replyTo: string): Promise<MessageRow | null> {
  const { data, error } = await context.supabase.from('talk_messages').select(MESSAGE_COLUMNS).eq('reply_to_message_id', replyTo).maybeSingle();
  if (error) throw new HttpError(503, 'Gurtu could not load this conversation right now. Please try again.');
  return (data ?? null) as MessageRow | null;
}

async function loadConversation(context: RequestContext, id: string) {
  const { data, error } = await context.supabase.from('conversations').select('id,title,last_activity_at').eq('id', id).maybeSingle();
  if (error) throw new HttpError(503, 'Gurtu could not load this conversation right now. Please try again.');
  if (!data) throw new HttpError(404, 'That conversation is not available.');
  return data as { id: string; title: string; last_activity_at: string };
}

/** The most recent turns before `message`, read from the database rather than trusted from the client. */
async function recentTurns(context: RequestContext, message: MessageRow): Promise<ConversationTurn[]> {
  const { data, error } = await context.supabase.from('talk_messages').select('role,content')
    .eq('conversation_id', message.conversation_id).lt('created_at', message.created_at)
    .order('created_at', { ascending: false }).limit(CONTEXT_TURNS);
  if (error) throw new HttpError(503, 'Gurtu could not load this conversation right now. Please try again.');
  return ((data ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse()
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, 500) }))
    .filter((turn) => turn.content.length > 0);
}

async function saveReply(context: RequestContext, replyTo: string, reply: Reply): Promise<MessageRow> {
  const { data, error } = await context.supabase.rpc('record_gurtu_reply', {
    p_reply_to_message_id: replyTo,
    p_content: reply.content,
    p_result_type: reply.result_type ?? null,
    p_result_id: reply.result_id ?? null,
    p_sources: reply.sources ?? [],
    p_metadata: reply.metadata,
  });
  if (error || typeof data !== 'string') throw new HttpError(503, 'Gurtu finished, but could not save its reply. Please try again.');
  const saved = await loadMessage(context, data);
  if (!saved) throw new HttpError(503, 'Gurtu finished, but could not save its reply. Please try again.');
  return saved;
}

function resultType(entity: ExecuteResult['result_entity_type']): ResultType | null {
  return entity === 'event' ? 'event' : entity === 'list' ? 'list' : entity === 'vocabulary' ? null : 'memory';
}

/** A confirmed meaning that teaching this alias would replace. */
async function vocabularyConflict(context: RequestContext, proposal: Extract<ActionProposal, { action: 'teach_vocabulary' }>) {
  if (proposal.relation !== 'same') return null;
  const { data } = await context.supabase.from('household_vocabulary').select('alias,canonical_term')
    .eq('status', 'confirmed').eq('entity_type', proposal.entity_type).limit(300);
  const canonical = normalizeAlias(proposal.canonical_term);
  const aliases = new Set(proposal.aliases.map(normalizeAlias));
  return ((data ?? []) as Array<{ alias: string; canonical_term: string }>)
    .find((row) => aliases.has(normalizeAlias(row.alias)) && normalizeAlias(row.canonical_term) !== canonical) ?? null;
}

function savedReply(text: string, proposal: ActionProposal, result: ExecuteResult): Reply {
  return {
    content: successMessage(text, proposal as ReplyProposal) || result.message || 'Saved to your family memory.',
    result_type: resultType(result.result_entity_type),
    result_id: result.result_entity_id,
    metadata: { kind: 'saved', entity_type: result.result_entity_type },
  };
}

/** Works out the reply for a saved user message. Safe to repeat for the same message. */
async function conversationSummary(context: RequestContext, conversationId: string): Promise<string | null> {
  const { data } = await context.supabase.from('conversations').select('summary_en').eq('id', conversationId).maybeSingle();
  return typeof data?.summary_en === 'string' && data.summary_en.trim() ? data.summary_en : null;
}

async function respondTo(context: RequestContext, message: MessageRow): Promise<Reply> {
  const text = message.content;
  const [turns, summary] = await timed('load_context', () => Promise.all([recentTurns(context, message), conversationSummary(context, message.conversation_id)]));
  if (isQuestion(text)) {
    const result = await timed('answer_question', () => answerQuestion(context, text, turns, summary));
    return { content: result.answer, result_type: 'answer', sources: result.sources, metadata: { kind: 'answer', found: result.found } };
  }

  const requestId = message.client_message_id!;
  const originalText = typeof message.metadata?.original_text === 'string' ? message.metadata.original_text : text;
  // Resume an earlier attempt of this same message instead of asking the model again.
  const earlier = await loadOwnCapture(context, requestId);
  let proposal: ActionProposal | null = null;
  let personIds: string[] = [];
  if (earlier && RESUMABLE.includes(earlier.processing_status) && earlier.extracted_payload) {
    try {
      proposal = validateProposal(earlier.extracted_payload);
      personIds = earlier.selected_person_ids ?? [];
    } catch {
      proposal = null;
    }
  }
  if (!proposal) {
    ({ proposal, personIds } = await timed('interpret', () => interpretCapture(context, {
      requestId,
      inputType: message.input_type ?? 'text',
      originalText,
      correctedText: text,
      conversationContext: turns,
      conversationSummary: summary,
    })));
  }

  if (proposal.action === 'clarify') return { content: proposal.question, metadata: { kind: 'clarify' } };
  if ((proposal.action === 'remove_list_item' || proposal.action === 'delete_event') && earlier?.processing_status !== 'succeeded') {
    const question = proposal.action === 'remove_list_item'
      ? removalQuestion(text, proposal.item_text, proposal.list_title)
      : deleteEventQuestion(text, proposal.event_title, proposal.local_date);
    return {
      content: question,
      metadata: { kind: 'confirm', request_id: requestId, target: proposal.action === 'delete_event' ? 'event' : 'list', telugu: isTeluguText(text) },
    };
  }
  if (proposal.action === 'teach_vocabulary' && earlier?.processing_status !== 'succeeded') {
    const conflict = await vocabularyConflict(context, proposal);
    if (conflict) {
      return {
        content: replaceVocabularyQuestion(text, conflict.alias, conflict.canonical_term, proposal.canonical_term),
        metadata: { kind: 'confirm', request_id: requestId, target: 'vocabulary', telugu: isTeluguText(text) },
      };
    }
  }
  const result = await timed('execute', () => executeCapture(context, requestId, personIds));
  return savedReply(text, proposal, result);
}

async function handleSend(context: RequestContext, request: Extract<MessageRequest, { action: 'send' }>) {
  const metadata = request.inputType === 'voice' && request.originalText && request.originalText !== request.text
    ? { original_text: request.originalText }
    : {};
  const { data, error } = await timed('save_message', async () => await context.supabase.rpc('start_gurtu_message', {
    p_conversation_id: request.conversationId,
    p_client_message_id: request.clientMessageId,
    p_content: request.text,
    p_input_type: request.inputType,
    p_language_code: detectLanguage(request.text),
    p_title: conversationTitle(request.text),
    p_metadata: metadata,
  }).single());
  if (error) {
    if (error.code === '42501') throw new HttpError(404, 'That conversation is not available.');
    if (error.code === '40001') throw new HttpError(409, 'Gurtu is still working on that message. Please wait a moment.');
    if (error.code === '23505') throw new HttpError(409, 'That message was already sent in another chat. Please send it again.');
    throw new HttpError(503, 'Your message could not be saved. Nothing was changed. Please try again.');
  }
  const started = data as { conversation_id: string; message_id: string; created: boolean };
  const ids = { conversation_id: started.conversation_id, message_id: started.message_id };
  try {
    const userMessage = await loadMessage(context, started.message_id);
    if (!userMessage) throw new HttpError(503, 'Your message could not be loaded. Please try again.');
    const existingReply = started.created ? null : await loadReply(context, userMessage.id);
    const reply = existingReply ?? await saveReply(context, userMessage.id, await respondTo(context, userMessage));
    const conversation = await loadConversation(context, started.conversation_id);
    indexInBackground(context);
    return { conversation, user_message: userMessage, reply };
  } catch (cause) {
    // The words are saved; tell the client where, so "Try again" resumes this message.
    if (cause instanceof HttpError) throw new HttpError(cause.status, cause.message, ids);
    throw new HttpError(500, 'Your words are saved, but Gurtu could not finish. Please try again.', ids);
  }
}

async function handleConfirmation(context: RequestContext, request: Extract<MessageRequest, { action: 'confirm' | 'cancel' }>) {
  const question = await loadMessage(context, request.confirmationMessageId);
  const metadata = question?.metadata ?? {};
  if (!question || question.conversation_id !== request.conversationId || question.role !== 'assistant'
    || metadata.kind !== 'confirm' || typeof metadata.request_id !== 'string') {
    throw new HttpError(404, 'That confirmation is no longer available.');
  }
  const existing = await loadReply(context, question.id);
  if (existing) return { conversation: await loadConversation(context, question.conversation_id), reply: existing };
  const telugu = metadata.telugu === true;
  let reply: Reply;
  if (request.action === 'cancel') {
    const { error } = await context.supabase.rpc('cancel_gurtu_capture', { p_request_id: metadata.request_id });
    if (error) throw new HttpError(503, 'Gurtu could not record that. Nothing was changed. Please try again.');
    reply = { content: cancelledMessage(telugu), metadata: { kind: 'cancelled' } };
  } else {
    const result = await timed('execute', () => executeCapture(context, metadata.request_id as string));
    reply = {
      content: confirmedMessage(telugu, metadata.target === 'event' ? 'event' : metadata.target === 'vocabulary' ? 'vocabulary' : 'list', result.message),
      result_type: resultType(result.result_entity_type),
      result_id: result.result_entity_id,
      metadata: { kind: 'saved', entity_type: result.result_entity_type },
    };
  }
  const saved = await saveReply(context, question.id, reply);
  indexInBackground(context);
  return { conversation: await loadConversation(context, question.conversation_id), reply: saved };
}

async function handler(context: RequestContext, request: Request) {
  const parsed = parseMessageRequest(await readJson(request, 64_000));
  if (!parsed.ok) throw new HttpError(parsed.status, parsed.error);
  return parsed.request.action === 'send'
    ? await handleSend(context, parsed.request)
    : await handleConfirmation(context, parsed.request);
}

Deno.serve((request) => withRequest(request, handler));
