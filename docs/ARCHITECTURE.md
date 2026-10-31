# Gurtu architecture

## Frontend

The Vite app is a responsive, static React SPA. React Router protects the home, remember, ask, memories, history, lists, calendar, and Family Activity routes. Supabase Auth restores email/password sessions. Registration is intentionally absent. `AuthProvider` shares the session and checks the trusted administrator role for navigation.

Feature pages remain small and use direct Supabase reads under the signed-in user's JWT. Writes that need cross-table work, idempotency, or audit history use Postgres RPC functions. `src/lib/actions.ts` validates action proposals in the browser as an additional UI check; the Edge Function validates again before it writes.

## Supabase

Postgres is the system of record. `families` contains three `households`; each auth user has one immutable `profiles` row. People are family-wide identity records used for tags, while memories, items, lists, and events have household ownership. RLS is enabled on every application table. Profile helper functions derive the authenticated household from `auth.uid()`.

List and event sharing uses separate access tables. `list_household_access` only grants access to its specific list. `event_household_access` only grants access to its specific event. Neither relationship changes memory ownership. Shared event recipients can read an event but only its owner household can edit it.

`provision_gurtu_family` is a trusted setup RPC limited to the Supabase `service_role`. It receives Auth user IDs created by the local admin script and atomically inserts the family, three households, five profiles, and six people. Normal requests use the user's own Supabase JWT and do not use the service key.

The trusted provisioner assigns the only `global_administrators` row to `chinna@gurtu.com`, while Chinna keeps a single profile in Household 2 with Ash. Global read policies check both that role and JWT assurance level `aal2`; the normal household policies remain in place for all other users and for Chinna before MFA. The browser uses the authenticated Supabase client. It never receives a service-role credential.

## Remember and write flow

1. The user types text or records a short clip.
2. When audio is used, `transcribe-audio` creates a text-only capture request, checks a per-account rate limit, sends the in-memory audio to OpenAI `gpt-transcribe`, stores the returned original transcript, and returns editable text. The recording itself is never persisted.
3. `process-memory-input` records typed input before interpretation, reads the signed-in family's identity directory, and asks OpenAI `gpt-6-luna` for a strict structured proposal.
4. Zod validates the model output. The capture request stores the validated interpretation, original transcript, and any corrected text separately. The user reviews the action and people tags.
5. After confirmation, the function reads the saved proposal from the user's capture, resolves selected IDs against the family directory, and calls a user-scoped database RPC. The RPC derives the household from the user's profile and rechecks the record permissions.
6. The capture stores its status and resulting record ID. Failures retain safe error details. Request IDs make retries idempotent.

The model never receives a database credential and never writes SQL. It cannot select a household ID or invent a person ID. A user must confirm before the family record is written.

## Family Activity

Chinna's Family Activity page requires a verified TOTP factor and an `aal2` session. The page reviews capture status, structured action details, shared result records, and safe failures. It does not expose the sender's original or corrected transcript; those remain available only through the owner-checked `get_own_capture_requests` RPC. Retry and correction RPCs check the trusted role and assurance level again in the database. Administrator activity is recorded in `admin_audit_log`. Corrections preserve the source text; location fixes append a history row.

## Ask and retrieval

`ask-memory` searches memories, latest item locations, accessible lists, and accessible events through the authenticated user's client. RLS filters every query. Each account's conversation is saved in `talk_messages` and is readable only by that account. Follow-up questions may include up to four recent turns so the model can resolve references, but only retrieved family records count as evidence. Candidate rows are ranked locally and at most twelve records are passed to the model. The model returns a structured answer with source IDs. The Edge Function discards any answer whose citations are absent or outside the retrieved records.

This first release uses Unicode token and substring matching, not embeddings. It keeps retrieval bounded and avoids sending the household's entire memory table to OpenAI. A later semantic search would need measured retrieval tests before adding embeddings or `pgvector`.

## Time and events

Events store UTC `starts_at` and `ends_at` plus the target household's IANA time zone. Local wall times are converted with Temporal's `disambiguation: reject`, so nonexistent or repeated daylight-saving times need a correction. All-day events use local midnight through the next local midnight.

The home screen fetches events that have not ended, then applies `now >= starts_at - 24 hours && now < ends_at` locally. It schedules one local timer for the next start-window or end boundary and refreshes when the page regains focus. There are no cron jobs, notifications, reminders, or background polling.
