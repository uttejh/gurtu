import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);

function originAllowed(origin: string): boolean {
  if (!origin) return true;
  if (APP_ORIGINS.includes(origin)) return true;
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname.endsWith('.pages.dev');
  } catch {
    return false;
  }
}

export function corsResponse(request: Request, status = 204, body?: unknown): Response {
  const origin = request.headers.get('origin') ?? '';
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  });
  if (origin && originAllowed(origin)) headers.set('Access-Control-Allow-Origin', origin);
  if (body !== undefined) headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

export function corsIsAllowed(request: Request): boolean {
  const origin = request.headers.get('origin') ?? '';
  return originAllowed(origin);
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface RequestContext {
  supabase: SupabaseClient;
  user: User;
  profile: { family_id: string; household_id: string; display_name: string; timezone: string };
}

export async function createRequestContext(request: Request): Promise<RequestContext> {
  const authorization = request.headers.get('authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!authorization?.startsWith('Bearer ') || !url || !key) throw new HttpError(401, 'Sign in to continue.');

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) throw new HttpError(401, 'Your session has expired. Please log in again.');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('family_id,household_id,display_name,households(timezone)')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  const row = profile as unknown as ({
    family_id: string;
    household_id: string;
    display_name: string;
    households?: { timezone?: string } | null;
  }) | null;
  if (profileError || !row || !row.households?.timezone) throw new HttpError(403, 'Your family profile is not set up yet.');
  return {
    supabase,
    user: userData.user,
    profile: {
      family_id: row.family_id,
      household_id: row.household_id,
      display_name: row.display_name,
      timezone: row.households.timezone,
    },
  };
}

export async function consumeLimit(context: RequestContext, bucket: 'ai_interpret' | 'ai_ask' | 'transcription') {
  const { data, error } = await context.supabase.rpc('consume_gurtu_rate_limit', { p_bucket: bucket });
  if (error) throw new HttpError(503, 'Gurtu is busy right now. Please try again shortly.');
  if (data !== true) throw new HttpError(429, 'Please wait a moment before trying again.');
}

export async function handleOptions(request: Request): Promise<Response | null> {
  if (request.method === 'OPTIONS') {
    return corsIsAllowed(request)
      ? corsResponse(request)
      : corsResponse(request, 403, { error: 'This website is not allowed to call Gurtu.' });
  }
  if (!corsIsAllowed(request)) return corsResponse(request, 403, { error: 'This website is not allowed to call Gurtu.' });
  if (request.method !== 'POST') return corsResponse(request, 405, { error: 'Use a POST request.' });
  return null;
}

export async function withRequest(
  request: Request,
  handler: (context: RequestContext, request: Request) => Promise<unknown>,
): Promise<Response> {
  const options = await handleOptions(request);
  if (options) return options;
  const startedAt = performance.now();
  try {
    const context = await createRequestContext(request);
    const result = await handler(context, request);
    console.info(JSON.stringify({ metric: 'edge_request', endpoint: new URL(request.url).pathname.split('/').at(-1), duration_ms: Math.round(performance.now() - startedAt), outcome: 'success' }));
    return corsResponse(request, 200, result);
  } catch (error) {
    console.info(JSON.stringify({ metric: 'edge_request', endpoint: new URL(request.url).pathname.split('/').at(-1), duration_ms: Math.round(performance.now() - startedAt), outcome: 'error' }));
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'We could not complete that request. Please try again.';
    return corsResponse(request, status, { error: message });
  }
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) throw new HttpError(413, 'That request is too large.');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new HttpError(413, 'That request is too large.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'The request could not be read.');
  }
}
