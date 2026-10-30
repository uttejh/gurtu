import { HttpError } from './http.ts';

const OPENAI_URL = 'https://api.openai.com/v1/responses';

export async function openAIJson<T>(input: {
  model?: string;
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  userContent: string;
  maxOutputTokens?: number;
}): Promise<T> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new HttpError(503, 'Gurtu AI is not configured yet.');
  const model = input.model ?? Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-6-luna';
  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model,
        max_output_tokens: input.maxOutputTokens ?? 1400,
        instructions: input.instructions,
        input: input.userContent,
        text: {
          format: {
            type: 'json_schema',
            name: input.name,
            strict: true,
            schema: input.schema,
          },
        },
      }),
    });
  } catch {
    throw new HttpError(503, 'Gurtu AI is temporarily unavailable. Please try again.');
  }
  if (!response.ok) throw new HttpError(response.status === 429 ? 503 : 502, 'Gurtu AI could not complete that request. Please try again.');
  let payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, 'Gurtu AI returned an unreadable response.');
  }
  const text = payload.output_text ?? payload.output?.flatMap((part) => part.content ?? []).find((part) => part.type === 'output_text')?.text;
  if (!text) throw new HttpError(502, 'Gurtu AI returned an empty response.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, 'Gurtu AI returned an invalid response.');
  }
}
