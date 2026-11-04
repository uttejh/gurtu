import { describe, expect, it } from 'vitest';
import { isOpenConfirmation, sortMessages, unansweredMessage, type TalkMessage } from '../../src/lib/talk';

function message(overrides: Partial<TalkMessage>): TalkMessage {
  return {
    id: 'm', conversation_id: 'c', role: 'user', content: 'hi', result_type: null, result_id: null, sources: [],
    created_at: '2026-11-04T10:00:00.000Z', client_message_id: null, reply_to_message_id: null, input_type: 'text', metadata: {},
    ...overrides,
  };
}

describe('chat message helpers', () => {
  it('orders by server receipt time and keeps a reply after its message', () => {
    const user = message({ id: 'u' });
    const reply = message({ id: 'r', role: 'assistant', reply_to_message_id: 'u' });
    expect(sortMessages([reply, user]).map((item) => item.id)).toEqual(['u', 'r']);
  });

  it('finds a saved message that never got a reply, so it can be retried after reload', () => {
    const user = message({ id: 'u' });
    expect(unansweredMessage([user])?.id).toBe('u');
    expect(unansweredMessage([user, message({ id: 'r', role: 'assistant', reply_to_message_id: 'u', created_at: '2026-11-04T10:00:01.000Z' })])).toBeNull();
    expect(unansweredMessage([message({ id: 'pending-x' })])).toBeNull();
  });

  it('shows confirmation buttons only until the question is answered', () => {
    const question = message({ id: 'q', role: 'assistant', metadata: { kind: 'confirm' } });
    expect(isOpenConfirmation(question, [question])).toBe(true);
    expect(isOpenConfirmation(question, [question, message({ id: 'a', role: 'assistant', reply_to_message_id: 'q' })])).toBe(false);
  });
});
