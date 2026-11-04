import { consumeLimit, HttpError, withRequest, type RequestContext } from '../_shared/http.ts';
import { OPENAI_BASE_URL } from '../_shared/openai.ts';
import { loadVocabulary } from '../_shared/capture.ts';
import { transcriptionHints } from '../_shared/vocabulary.ts';

type PersonRow = { display_name: string; aliases: string[] };

async function handler(context: RequestContext, request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 24 * 1024 * 1024) throw new HttpError(413, 'That recording is too large. Please record a shorter clip.');
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
  const requestId = form.get('request_id');
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
    form.delete('file');
    throw new HttpError(400, 'The recording request could not be verified. Please try again.');
  }
  const { error: captureError } = await context.supabase.rpc('create_gurtu_capture_request', {
    p_request_id: requestId,
    p_input_type: 'voice',
    p_original_transcript: null,
  });
  if (captureError) {
    form.delete('file');
    throw new HttpError(503, 'The recording could not be safely received. Please try again.');
  }
  try {
    await consumeLimit(context, 'transcription');
  } catch (error) {
    await context.supabase.rpc('fail_gurtu_capture', {
      p_request_id: requestId, p_processing_status: 'transcription_failed',
      p_error_code: 'TRANSCRIPTION_RATE_LIMIT', p_safe_error_description: 'The recording reached Gurtu but could not be processed yet.',
    });
    throw error;
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    form.delete('file');
    await context.supabase.rpc('fail_gurtu_capture', {
      p_request_id: requestId, p_processing_status: 'transcription_failed',
      p_error_code: 'TRANSCRIPTION_UNAVAILABLE', p_safe_error_description: 'Voice transcription is not configured yet.',
    });
    throw new HttpError(503, 'Gurtu voice transcription is not configured yet.');
  }
  const { data: people, error: peopleError } = await context.supabase.from('people')
    .select('display_name,aliases').eq('family_id', context.profile.family_id).eq('is_active', true).limit(100);
  if (peopleError) {
    form.delete('file');
    await context.supabase.rpc('fail_gurtu_capture', {
      p_request_id: requestId, p_processing_status: 'transcription_failed',
      p_error_code: 'FAMILY_HINTS_UNAVAILABLE', p_safe_error_description: 'Family voice hints are not available right now.',
    });
    throw new HttpError(503, 'Family voice hints are not available right now.');
  }
  const familyNames = ((people ?? []) as PersonRow[]).flatMap((person) => [person.display_name, ...(person.aliases ?? [])]).filter(Boolean);
  // A small relevant subset of confirmed household vocabulary: the current chat's
  // topic first, then recent terms. Never the whole dictionary.
  const conversationId = form.get('conversation_id');
  const [vocabulary, summary] = await Promise.all([
    loadVocabulary(context),
    typeof conversationId === 'string' && /^[0-9a-f-]{36}$/iu.test(conversationId)
      ? context.supabase.from('conversations').select('summary_en').eq('id', conversationId).maybeSingle()
        .then(({ data }) => (typeof data?.summary_en === 'string' ? data.summary_en : null))
      : Promise.resolve(null),
  ]);
  const names = transcriptionHints(vocabulary, summary, familyNames, 40).join(', ');
  const upstreamForm = new FormData();
  let audioBytes: Uint8Array<ArrayBuffer> | null = null;
  const transcriptionStartedAt = performance.now();
  try {
    audioBytes = new Uint8Array(await audio.arrayBuffer());
    upstreamForm.append('file', new File([audioBytes], audio.name || 'family-memory-audio', { type: audio.type || 'application/octet-stream' }));
    upstreamForm.append('model', Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') ?? 'gpt-transcribe');
    upstreamForm.append('response_format', 'json');
    upstreamForm.append('prompt', `The speaker may use Telangana Telugu, English, or mix both naturally. Preserve Telugu script and the words as spoken. Names and words this family uses (spell them this way only if they are actually spoken): ${names}. Do not translate.`);
    try {
      const upstream = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstreamForm,
        signal: AbortSignal.timeout(55_000),
      });
      console.info(JSON.stringify({ metric: 'openai_transcription', duration_ms: Math.round(performance.now() - transcriptionStartedAt), outcome: upstream.ok ? 'success' : 'error' }));
      if (!upstream.ok) throw new HttpError(upstream.status === 429 ? 503 : 502, 'That recording could not be transcribed. Please try again or type instead.');
      let result: { text?: string };
      try {
        result = await upstream.json();
      } catch {
        throw new HttpError(502, 'Voice transcription returned an unreadable result.');
      }
      const transcript = typeof result.text === 'string' ? result.text.trim() : '';
      if (!transcript || transcript.length > 8000) throw new HttpError(502, 'No clear words were detected. Please try again or type instead.');
      const { error: transcriptSaveError } = await context.supabase.rpc('create_gurtu_capture_request', {
        p_request_id: requestId, p_input_type: 'voice', p_original_transcript: transcript,
      });
      if (transcriptSaveError) throw new HttpError(503, 'The transcript could not be safely saved. Please try again.');
      return { transcript, request_id: requestId };
    } catch (error) {
      await context.supabase.rpc('fail_gurtu_capture', {
        p_request_id: requestId, p_processing_status: 'transcription_failed',
        p_error_code: error instanceof HttpError && error.status === 503 ? 'TRANSCRIPTION_UNAVAILABLE' : 'TRANSCRIPTION_FAILED',
        p_safe_error_description: 'The recording reached Gurtu but could not be transcribed.',
      });
      throw error;
    }
  } finally {
    audioBytes?.fill(0);
    upstreamForm.delete('file');
    form.delete('file');
    audioBytes = null;
  }
}

Deno.serve((request) => withRequest(request, handler));
