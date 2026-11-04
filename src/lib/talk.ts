import { supabase } from './supabase';

export type TalkResultType = 'memory' | 'list' | 'event' | 'answer';

export interface TalkSource {
  id: string;
  original_text: string;
  created_at: string;
  kind?: string;
}

export interface TalkMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  result_type: TalkResultType | null;
  result_id: string | null;
  sources: TalkSource[];
  created_at: string;
  client_message_id: string | null;
  reply_to_message_id: string | null;
  input_type: 'text' | 'voice' | null;
  metadata: { kind?: string; original_text?: string; target?: string; [key: string]: unknown };
}

export interface ConversationSummary {
  id: string;
  title: string;
  last_activity_at: string;
}

export interface ProcessResult {
  conversation: ConversationSummary;
  user_message?: TalkMessage;
  reply: TalkMessage;
}

export type ProcessRequest =
  | { action: 'send'; conversation_id: string | null; client_message_id: string; text: string; input_type: 'text' | 'voice'; original_text: string | null }
  | { action: 'confirm' | 'cancel'; conversation_id: string; confirmation_message_id: string };

export const MESSAGE_COLUMNS = 'id,conversation_id,role,content,result_type,result_id,sources,created_at,client_message_id,reply_to_message_id,input_type,metadata';

/** An error from process-message. When the words were saved, it says where. */
export class TalkRequestError extends Error {
  constructor(message: string, readonly conversationId: string | null = null, readonly messageId: string | null = null) {
    super(message);
  }
}

const OFFLINE = 'We could not connect. Please check your internet and try again. Your words are still here.';

export async function processMessage(body: ProcessRequest, fallback: string): Promise<ProcessResult> {
  if (!supabase) throw new TalkRequestError('Gurtu is not connected yet. Your message was not sent.');
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke('process-message', { body }));
  } catch {
    throw new TalkRequestError(OFFLINE);
  }
  if (!error) {
    const result = data as ProcessResult | null;
    if (!result?.reply?.id || !result.conversation?.id) throw new TalkRequestError(fallback);
    return result;
  }
  if (error instanceof Error && /network|fetch|failed to send/iu.test(error.message)) throw new TalkRequestError(OFFLINE);
  const response = (error as { context?: unknown }).context;
  if (response instanceof Response) {
    try {
      const payload = await response.clone().json() as { error?: unknown; conversation_id?: unknown; message_id?: unknown };
      const message = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : fallback;
      throw new TalkRequestError(
        message,
        typeof payload.conversation_id === 'string' ? payload.conversation_id : null,
        typeof payload.message_id === 'string' ? payload.message_id : null,
      );
    } catch (cause) {
      if (cause instanceof TalkRequestError) throw cause;
    }
  }
  throw new TalkRequestError(fallback);
}

/** Sorts messages by server receipt time, placing a reply after the message it answers. */
export function sortMessages(messages: TalkMessage[]): TalkMessage[] {
  return [...messages].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)
    || (left.reply_to_message_id === right.id ? 1 : right.reply_to_message_id === left.id ? -1 : 0));
}

/** The last user message that never received a reply, so it can be retried after a reload. */
export function unansweredMessage(messages: TalkMessage[]): TalkMessage | null {
  const last = messages.at(-1);
  if (!last || last.role !== 'user' || last.id.startsWith('pending-')) return null;
  return messages.some((message) => message.reply_to_message_id === last.id) ? null : last;
}

/** A confirmation question that has not been answered yet. */
export function isOpenConfirmation(message: TalkMessage, messages: TalkMessage[]): boolean {
  return message.role === 'assistant' && message.metadata?.kind === 'confirm'
    && !messages.some((other) => other.reply_to_message_id === message.id);
}

export function formatChatTime(value: string, now = new Date()): string {
  const date = new Date(value);
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(date)
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }).format(date);
}
