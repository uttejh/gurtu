// Request parsing and chat titles for process-message. No runtime-specific
// imports, so these rules can be unit-tested.

export const MAX_MESSAGE_LENGTH = 8000;
const TITLE_LENGTH = 48;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type MessageRequest =
  | { action: 'send'; conversationId: string | null; clientMessageId: string; text: string; inputType: 'text' | 'voice'; originalText: string | null }
  | { action: 'confirm' | 'cancel'; conversationId: string; confirmationMessageId: string };

export type ParsedRequest = { ok: true; request: MessageRequest } | { ok: false; status: number; error: string };

const UNREADABLE = 'Gurtu could not read that request. Please refresh the page and try again.';

function graphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);
  }
  return [...value];
}

/** A short automatic title from the first message; never splits a Telugu letter. */
export function conversationTitle(text: string): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!clean) return 'New chat';
  const letters = graphemes(clean);
  if (letters.length <= TITLE_LENGTH) return clean;
  const cut = letters.slice(0, TITLE_LENGTH).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace >= 20 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/u, '')}…`;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Validates a process-message request and gives a specific, honest error. */
export function parseMessageRequest(value: unknown): ParsedRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, status: 400, error: UNREADABLE };
  const body = value as Record<string, unknown>;
  if (body.action === 'confirm' || body.action === 'cancel') {
    if (!isUuid(body.conversation_id) || !isUuid(body.confirmation_message_id)) return { ok: false, status: 400, error: UNREADABLE };
    return { ok: true, request: { action: body.action, conversationId: body.conversation_id, confirmationMessageId: body.confirmation_message_id } };
  }
  if (body.action !== 'send') return { ok: false, status: 400, error: UNREADABLE };
  if (body.conversation_id !== null && body.conversation_id !== undefined && !isUuid(body.conversation_id)) return { ok: false, status: 400, error: UNREADABLE };
  if (!isUuid(body.client_message_id)) return { ok: false, status: 400, error: UNREADABLE };
  if (body.input_type !== 'text' && body.input_type !== 'voice') return { ok: false, status: 400, error: UNREADABLE };
  if (typeof body.text !== 'string') return { ok: false, status: 400, error: UNREADABLE };
  const text = body.text.trim();
  if (!text) return { ok: false, status: 400, error: 'Please type or say something first.' };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, status: 413, error: 'That message is too long. Please keep it under 8,000 characters.' };
  let originalText: string | null = null;
  if (body.original_text !== undefined && body.original_text !== null) {
    if (typeof body.original_text !== 'string') return { ok: false, status: 400, error: UNREADABLE };
    const original = body.original_text.trim();
    if (original.length > MAX_MESSAGE_LENGTH) return { ok: false, status: 413, error: 'That recording is too long. Please keep it under 8,000 characters.' };
    originalText = original || null;
  }
  return {
    ok: true,
    request: {
      action: 'send',
      conversationId: (body.conversation_id as string | null | undefined) ?? null,
      clientMessageId: body.client_message_id,
      text,
      inputType: body.input_type,
      originalText: body.input_type === 'voice' ? originalText : null,
    },
  };
}
