import { describe, expect, it } from 'vitest';
import { ActionProposalSchema } from '../../src/lib/actions';

describe('AI action validation', () => {
  it('preserves the original Telugu sentence in a memory proposal', () => {
    const originalText = 'నా పాస్‌బుక్ కారులో పెట్టాను.';
    const proposal = ActionProposalSchema.parse({
      action: 'save_memory',
      original_text: originalText,
      people_mentions: ['Dad'],
      summary: null,
    });
    expect(proposal.action).toBe('save_memory');
    if (proposal.action === 'save_memory') expect(proposal.original_text).toBe(originalText);
  });

  it('requires an IANA time zone for a timed event proposal', () => {
    const result = ActionProposalSchema.safeParse({
      action: 'create_event',
      title: 'Bank appointment',
      local_date: '2026-11-12',
      local_time: '10:00',
      time_zone: '',
      all_day: false,
      people_mentions: ['Dad'],
      end_time_assumed: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a clarification proposal instead of inventing a missing event date', () => {
    const proposal = ActionProposalSchema.parse({
      action: 'clarify',
      question: 'Which date did you mean?',
    });
    expect(proposal.action).toBe('clarify');
  });

  it('rejects unsupported actions', () => {
    expect(ActionProposalSchema.safeParse({ action: 'send_notification' }).success).toBe(false);
  });
});
