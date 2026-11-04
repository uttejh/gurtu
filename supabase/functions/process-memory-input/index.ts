import { z } from 'npm:zod@4.6.7';
import { executeCapture, interpretCapture } from '../_shared/capture.ts';
import { HttpError, readJson, withRequest, type RequestContext } from '../_shared/http.ts';

// Kept for clients that have not yet loaded the process-message app version.
const InputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('interpret'), input_type: z.enum(['text', 'voice']), original_text: z.string().trim().min(1).max(8000), corrected_text: z.string().trim().min(1).max(8000), request_id: z.string().uuid(), conversation_context: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8000).transform((value) => value.slice(0, 500)) }).strict()).max(12).optional() }).strict(),
  z.object({ mode: z.literal('execute'), request_id: z.string().uuid(), person_ids: z.array(z.string().uuid()).max(100), confirmed: z.literal(true) }).strict(),
]);

async function handler(context: RequestContext, request: Request) {
  const parsed = InputSchema.safeParse(await readJson(request, 12_000));
  if (!parsed.success) throw new HttpError(400, 'Please check the details and try again.');
  const input = parsed.data;
  if (input.mode === 'interpret') {
    const { proposal } = await interpretCapture(context, {
      requestId: input.request_id,
      inputType: input.input_type,
      originalText: input.original_text,
      correctedText: input.corrected_text,
      conversationContext: input.conversation_context ?? [],
    });
    return { proposal, request_id: input.request_id };
  }
  return await executeCapture(context, input.request_id, input.person_ids);
}

Deno.serve((request) => withRequest(request, handler));
