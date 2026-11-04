import { z } from 'npm:zod@4.6.7';
import { answerQuestion } from '../_shared/ask.ts';
import { HttpError, readJson, withRequest, type RequestContext } from '../_shared/http.ts';

// Kept for clients that have not yet loaded the process-message app version.
const InputSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  conversation_context: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(8000).transform((value) => value.slice(0, 500)),
  }).strict()).max(12).optional(),
}).strict();

async function handler(context: RequestContext, request: Request) {
  const parsed = InputSchema.safeParse(await readJson(request, 16_000));
  if (!parsed.success) {
    const question = (parsed.error.issues.find((issue) => issue.path[0] === 'question'));
    if (!question) throw new HttpError(400, 'Gurtu could not read the earlier conversation. Please try again.');
    throw new HttpError(400, question.code === 'too_big' ? 'Please keep your question under 2,000 characters.' : 'Please type or say a question first.');
  }
  return await answerQuestion(context, parsed.data.question, parsed.data.conversation_context ?? []);
}

Deno.serve((request) => withRequest(request, handler));
