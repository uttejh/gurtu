# Gurtu architecture

## Frontend

The Vite app is a responsive, static React SPA. React Router protects the home, remember, ask, memories, history, lists, and calendar routes. Supabase Auth restores email/password sessions. Registration is intentionally absent. `AuthProvider` shares the session with route gates and data hooks.

Feature pages remain small and use direct Supabase reads under the signed-in user's JWT. Writes that need cross-table work, idempotency, or audit history use Postgres RPC functions. `src/lib/actions.ts` validates action proposals in the browser as an additional UI check; the Edge Function validates again before it writes.

## Supabase

Postgres is the system of record. `families` contains three `households`; each auth user has one immutable `profiles` row. People are family-wide identity records used for tags, while memories, items, lists, and events have household ownership. RLS is enabled on every application table. Profile helper functions derive the authenticated household from `auth.uid()`.

List and event sharing uses separate access tables. `list_household_access` only grants access to its specific list. `event_household_access` only grants access to its specific event. Neither relationship changes memory ownership. Shared event recipients can read an event but only its owner household can edit it.

`provision_gurtu_family` is a trusted setup RPC limited to the Supabase `service_role`. It receives Auth user IDs created by the local admin script and atomically inserts the family, three households, five profiles, and six people. Normal requests use the user's own Supabase JWT and do not use the service key.

## Remember and write flow

1. The user types text or records a short clip.
2. When audio is used, `transcribe-audio` authenticates the user, checks a per-account rate limit, sends the in-memory audio to OpenAI `gpt-transcribe`, and returns editable text.
3. `process-memory-input` reads only the signed-in family's identity directory and asks OpenAI `gpt-6-luna` for a strict structured proposal.
4. Zod validates the model output. The user reviews the action, original text, and people tags.
5. After confirmation, the function resolves selected IDs against the family directory and calls one user-scoped database RPC. The RPC derives the household from the user's profile and rechecks the record permissions.
6. The database stores the original words and minimal structured activity metadata. Request IDs make retries idempotent.

The model never receives a database credential and never writes SQL. It cannot select a household ID or invent a person ID.

## Ask and retrieval

`ask-memory` does not save the question. PostgREST searches memories, latest item locations, accessible lists, and accessible events through the authenticated user's client. RLS filters every query. Candidate rows are ranked locally and at most twelve records are passed to the model. The model receives those rows as untrusted evidence and returns a structured answer with source IDs. The Edge Function discards any answer whose citations are absent or outside the retrieved records.

This first release uses Unicode token and substring matching, not embeddings. It keeps retrieval bounded and avoids sending the household's entire memory table to OpenAI. A later semantic search would need measured retrieval tests before adding embeddings or `pgvector`.

## Time and events

Events store UTC `starts_at` and `ends_at` plus the target household's IANA time zone. Local wall times are converted with Temporal's `disambiguation: reject`, so nonexistent or repeated daylight-saving times need a correction. All-day events use local midnight through the next local midnight.

The home screen fetches events that have not ended, then applies `now >= starts_at - 24 hours && now < ends_at` locally. It schedules one local timer for the next start-window or end boundary and refreshes when the page regains focus. There are no cron jobs, notifications, reminders, or background polling.
