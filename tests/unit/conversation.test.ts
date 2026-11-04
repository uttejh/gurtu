import { describe, expect, it } from 'vitest';
import { conversationTitle, parseMessageRequest } from '../../supabase/functions/_shared/conversation';

const ID = '7b0c3f5e-2f1a-4c39-9a4e-1d2b3c4d5e6f';

describe('automatic chat titles', () => {
  it('keeps a short first message as the title', () => {
    expect(conversationTitle('  Do I have any   events this month?  ')).toBe('Do I have any events this month?');
  });

  it('shortens a long message at a word boundary', () => {
    const title = conversationTitle('Please remember that the tractor service is booked with Ramesh for next Friday morning');
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(49);
    expect(title).not.toMatch(/\s…$/u);
  });

  it('never splits a Telugu letter', () => {
    const telugu = 'వచ్చే వారం రమేష్ కి డబ్బులు ఇవ్వాలి. ట్రాక్టర్ పని చేశాడు. అమ్మ చెప్పింది.';
    const title = conversationTitle(telugu);
    const body = title.replace(/…$/u, '');
    expect(telugu.startsWith(body)).toBe(true);
    expect(body).not.toMatch(/[్]$/u);
  });
});

describe('process-message request validation', () => {
  const send = { action: 'send', conversation_id: null, client_message_id: ID, input_type: 'text' };

  it('accepts a short calendar question (the old 2,000-character false alarm)', () => {
    const parsed = parseMessageRequest({ ...send, text: 'do i have any events this month?' });
    expect(parsed).toMatchObject({ ok: true, request: { action: 'send', text: 'do i have any events this month?' } });
  });

  it('gives a genuine empty-input error', () => {
    expect(parseMessageRequest({ ...send, text: '   ' })).toEqual({ ok: false, status: 400, error: 'Please type or say something first.' });
  });

  it('gives a genuine length error', () => {
    expect(parseMessageRequest({ ...send, text: 'a'.repeat(8001) })).toMatchObject({ ok: false, status: 413 });
  });

  it('keeps the original transcript only for voice messages', () => {
    expect(parseMessageRequest({ ...send, input_type: 'voice', text: 'edited', original_text: 'spoken' }))
      .toMatchObject({ ok: true, request: { inputType: 'voice', originalText: 'spoken' } });
    expect(parseMessageRequest({ ...send, text: 'typed', original_text: 'ignored' }))
      .toMatchObject({ ok: true, request: { originalText: null } });
  });

  it('refuses malformed IDs without blaming the message length', () => {
    const parsed = parseMessageRequest({ ...send, client_message_id: 'not-an-id', text: 'hello' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).not.toMatch(/2,000|characters/u);
  });

  it('accepts confirm and cancel actions on a saved confirmation', () => {
    expect(parseMessageRequest({ action: 'confirm', conversation_id: ID, confirmation_message_id: ID })).toMatchObject({ ok: true });
    expect(parseMessageRequest({ action: 'cancel', conversation_id: ID })).toMatchObject({ ok: false });
  });
});
