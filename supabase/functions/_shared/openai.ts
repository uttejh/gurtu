import { HttpError } from './http.ts';

// OPENAI_BASE_URL lets local tests point at a stub; production uses the default.
export const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/u, '');
const OPENAI_URL = `${OPENAI_BASE_URL}/responses`;

export async function openAIJson<T>(input: {
  model?: string;
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  userContent: string;
  maxOutputTokens?: number;
  /** Lower effort for simple rewriting or extraction steps; omitted uses the model default. */
  reasoningEffort?: 'none' | 'low' | 'medium';
}): Promise<T> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new HttpError(503, 'Gurtu AI is not configured yet.');
  const model = input.model ?? Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-6-luna';
  let response: Response;
  const startedAt = performance.now();
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model,
        max_output_tokens: input.maxOutputTokens ?? 1400,
        ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
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
    console.info(JSON.stringify({ metric: 'openai_call', operation: input.name, model, duration_ms: Math.round(performance.now() - startedAt), outcome: 'network_error' }));
    throw new HttpError(503, 'Gurtu AI is temporarily unavailable. Please try again.');
  }
  console.info(JSON.stringify({ metric: 'openai_call', operation: input.name, model, duration_ms: Math.round(performance.now() - startedAt), outcome: response.ok ? 'success' : 'error' }));
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

export const EMBEDDING_DIMENSIONS = 1536;

export function embeddingModel(): string {
  return Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small';
}

/** Embeds English texts with the one configured model; the index is fixed at 1536 dimensions. */
export async function openAIEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new HttpError(503, 'Gurtu AI is not configured yet.');
  const model = embeddingModel();
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ model, input: texts.map((text) => text.slice(0, 6000)), dimensions: EMBEDDING_DIMENSIONS }),
    });
  } catch {
    console.info(JSON.stringify({ metric: 'openai_call', operation: 'embeddings', model, duration_ms: Math.round(performance.now() - startedAt), outcome: 'network_error' }));
    throw new HttpError(503, 'Gurtu AI is temporarily unavailable. Please try again.');
  }
  console.info(JSON.stringify({ metric: 'openai_call', operation: 'embeddings', model, inputs: texts.length, duration_ms: Math.round(performance.now() - startedAt), outcome: response.ok ? 'success' : 'error' }));
  if (!response.ok) throw new HttpError(502, 'Gurtu AI could not complete that request. Please try again.');
  const payload = await response.json().catch(() => null) as { data?: Array<{ index: number; embedding: number[] }> } | null;
  const rows = [...(payload?.data ?? [])].sort((left, right) => left.index - right.index).map((row) => row.embedding);
  if (rows.length !== texts.length || rows.some((row) => row.length !== EMBEDDING_DIMENSIONS)) {
    throw new HttpError(502, 'Gurtu AI returned an unexpected search index result.');
  }
  return rows;
}

/** pgvector text form of an embedding. */
export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
