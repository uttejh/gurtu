import { describe, expect, it } from 'vitest';
import { completedCaptureResult } from '../../supabase/functions/_shared/capture-result';

describe('completed capture retries', () => {
  it('returns the existing event without re-running the save', () => {
    expect(completedCaptureResult({
      processing_status: 'succeeded',
      result_entity_type: 'event',
      result_entity_id: 'flight-event-id',
    })).toEqual({
      ok: true,
      message: 'Saved to your family memories and calendar.',
      result_entity_type: 'event',
      result_entity_id: 'flight-event-id',
    });
  });

  it('does not treat an unfinished capture as completed', () => {
    expect(completedCaptureResult({
      processing_status: 'operation_failed',
      result_entity_type: null,
      result_entity_id: null,
    })).toBeNull();
  });
});
