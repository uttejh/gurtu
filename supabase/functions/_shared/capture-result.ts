export type CaptureEntityType = 'memory' | 'item' | 'list' | 'event' | 'vocabulary';

export interface CompletedCapture {
  processing_status: string;
  result_entity_type: CaptureEntityType | null;
  result_entity_id: string | null;
}

export function completedCaptureResult(capture: CompletedCapture) {
  if (capture.processing_status !== 'succeeded' || !capture.result_entity_type || !capture.result_entity_id) return null;
  const message = capture.result_entity_type === 'event'
    ? 'Saved to your family memories and calendar.'
    : capture.result_entity_type === 'list'
      ? 'Your family list was updated.'
      : capture.result_entity_type === 'vocabulary'
        ? 'I will remember that.'
        : 'Saved to your family memories.';
  return {
    ok: true,
    message,
    result_entity_type: capture.result_entity_type,
    result_entity_id: capture.result_entity_id,
  } as const;
}
