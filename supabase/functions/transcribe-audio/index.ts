import { consumeLimit, HttpError, withRequest, type RequestContext } from '../_shared/http.ts';

type PersonRow = { display_name: string; aliases: string[] };

async function handler(context: RequestContext, request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 24 * 1024 * 1024) throw new HttpError(413, 'That recording is too large. Please record a shorter clip.');
  await consumeLimit(context, 'transcription');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'The recording could not be read. Please try again.');
  }
  const audio = form.get('file');
  if (!(audio instanceof File) || audio.size < 1 || audio.size > 22 * 1024 * 1024) {
    form.delete('file');
    throw new HttpError(413, 'That recording could not be processed. Please record a shorter clip.');
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    form.delete('file');
    throw new HttpError(503, 'Gurtu voice transcription is not configured yet.');
  }
  const { data: people, error: peopleError } = await context.supabase.from('people')
    .select('display_name,aliases').eq('family_id', context.profile.family_id).eq('is_active', true).limit(100);
  if (peopleError) {
    form.delete('file');
    throw new HttpError(503, 'Family voice hints are not available right now.');
  }
  const names = ((people ?? []) as PersonRow[]).flatMap((person) => [person.display_name, ...(person.aliases ?? [])])
    .filter(Boolean).slice(0, 160).join(', ');
  const upstreamForm = new FormData();
  let audioBytes: Uint8Array | null = null;
  try {
    audioBytes = new Uint8Array(await audio.arrayBuffer());
    upstreamForm.append('file', new File([audioBytes], audio.name || 'family-memory-audio', { type: audio.type || 'application/octet-stream' }));
    upstreamForm.append('model', Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') ?? 'gpt-transcribe');
    upstreamForm.append('response_format', 'json');
    upstreamForm.append('prompt', `The speaker may use Telangana Telugu, English, or mix both naturally. Preserve Telugu script and the words as spoken. Family names and aliases: ${names}. Do not translate.`);
    let upstream: Response;
    try {
      upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstreamForm,
        signal: AbortSignal.timeout(55_000),
      });
    } catch {
      throw new HttpError(503, 'Voice transcription is temporarily unavailable. Please try again or type instead.');
    }
    if (!upstream.ok) throw new HttpError(upstream.status === 429 ? 503 : 502, 'That recording could not be transcribed. Please try again or type instead.');
    let result: { text?: string };
    try {
      result = await upstream.json();
    } catch {
      throw new HttpError(502, 'Voice transcription returned an unreadable result.');
    }
    const transcript = typeof result.text === 'string' ? result.text.trim() : '';
    if (!transcript || transcript.length > 8000) throw new HttpError(502, 'No clear words were detected. Please try again or type instead.');
    return { transcript };
  } finally {
    audioBytes?.fill(0);
    upstreamForm.delete('file');
    form.delete('file');
    audioBytes = null;
  }
}

Deno.serve((request) => withRequest(request, handler));
