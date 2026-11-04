# Gurtu architecture

## Frontend

The Vite app is a responsive, static React SPA. React Router protects the home, talk (`/talk/:conversationId?`), chats, memories, history, lists, calendar, and Family Activity routes. Supabase Auth restores email/password sessions. Registration is intentionally absent. `AuthProvider` shares the session and checks the trusted administrator role for navigation.

Feature pages remain small and use direct Supabase reads under the signed-in user's JWT. Writes that need cross-table work, idempotency, or audit history use Postgres RPC functions. Chat messages are never written by the browser in the current app version; the `process-message` Edge Function saves them.

## Supabase

Postgres is the system of record. `families` contains three `households`; each auth user has one immutable `profiles` row. People are family-wide identity records used for tags, while memories, items, lists, and events have household ownership. RLS is enabled on every application table. Profile helper functions derive the authenticated household from `auth.uid()`.

List and event sharing uses separate access tables. `list_household_access` only grants access to its specific list. `event_household_access` only grants access to its specific event. Neither relationship changes memory ownership. Shared event recipients can read an event but only its owner household can edit it.

`provision_gurtu_family` is a trusted setup RPC limited to the Supabase `service_role`. It receives Auth user IDs created by the local admin script and atomically inserts the family, three households, five profiles, and six people. Normal requests use the user's own Supabase JWT and do not use the service key.

The trusted provisioner assigns the only `global_administrators` row to `chinna@gurtu.com`, while Chinna keeps a single profile in Household 2 with Ash. Global read policies check both that role and JWT assurance level `aal2`; the normal household policies remain in place for all other users and for Chinna before MFA. The browser uses the authenticated Supabase client. It never receives a service-role credential.

## Conversations and the message pipeline

Each login has any number of conversations (`conversations`, owner-only RLS). Parents share one login and therefore one set of chats. Every chat message is a `talk_messages` row with a `conversation_id`, the server receipt time (`created_at`, set by a trigger with `clock_timestamp()`), a per-login `client_message_id`, and, for assistant rows, `reply_to_message_id`. A partial unique index allows exactly one reply per message.

All chat traffic goes through one Edge Function, `process-message`:

1. Validate the request with specific errors (empty, too long, unreadable).
2. `start_gurtu_message` saves the user's words before any AI work. Repeating the same `client_message_id` returns the original row instead of saving a copy. A first message without a conversation creates one, titled from that message.
3. If the message already has a reply, return it. A retry never acts twice.
4. Load up to 12 earlier turns of this conversation from the database. Client-supplied history is not trusted.
5. Questions (`_shared/intent.ts`) go to `_shared/ask.ts`. Other messages go to `_shared/capture.ts`: interpret once with OpenAI structured output, record the interpretation in `capture_requests`, then execute through the existing idempotent RPCs. If an earlier attempt of the same message was already interpreted or saved, it resumes from that record without another model call.
6. Removals and event deletions reply with a confirmation question (`metadata.kind = 'confirm'`). "Yes, proceed" and "Keep it" are `confirm`/`cancel` requests that act on that saved question; `cancel_gurtu_capture` records the cancellation.
7. `record_gurtu_reply` saves exactly one assistant reply. Success is reported only after the database write commits.

If AI or database work fails after step 2, the error response includes the `conversation_id` and `message_id`, so the app can show "Try again" in the right chat. After a reload, a last user message without a reply also offers "Try again".

`ask-memory` and `process-memory-input` remain deployed as thin wrappers around the same shared modules for app versions loaded before `process-message`. Direct `talk_messages` inserts from those versions still work and join the login's most recent conversation.

## Capture details

When audio is used, `transcribe-audio` creates a text-only capture request, checks a per-account rate limit, sends the in-memory audio to OpenAI, stores the returned original transcript, and returns editable text. The recording itself is never persisted. The transcription request ID becomes the chat message's `client_message_id`, and an edited transcript keeps the original words in the message `metadata.original_text`.

Zod validates the model output. The capture request stores the validated interpretation, original transcript, corrected text, and people tags (names matched in the words plus exact directory matches the model reported). The RPCs derive the household from the user's profile and recheck record permissions. The model never receives a database credential and never writes SQL. It cannot select a household ID or invent a person ID.

## Family Activity

Chinna's Family Activity page requires a verified TOTP factor and an `aal2` session. The page reviews capture status, structured action details, shared result records, and safe failures. It does not expose the sender's original or corrected transcript; those remain available only through the owner-checked `get_own_capture_requests` RPC. Retry and correction RPCs check the trusted role and assurance level again in the database. Administrator activity is recorded in `admin_audit_log`. Corrections preserve the source text; location fixes append a history row.

## Ask and retrieval

Questions go through `_shared/ask.ts` with the authenticated user's client, so RLS filters every query.

1. Calendar questions that name a period (today, tomorrow, this/next week, this/next month, and Telugu equivalents) query events overlapping that household-local period directly.
2. Telugu-script questions are first rewritten as an English search query (`gurtu_search_query`, reasoning effort `none`, about 1.3 s).
3. Retrieval runs in parallel: keyword matching over memories, item locations, lists and events, and hybrid household recall (`match_gurtu_family_memories`: pgvector cosine similarity on English text plus full-text match, fused by rank).
4. One grounded answer call receives at most fourteen records, the recent turns and the conversation summary. It answers in the user's language, keeps plans distinct from completed actions, and cites record IDs. Answers that claim a family fact without valid citations are replaced with an honest "not found". When nothing answers a family question, the same call may help with any general part.

An English question with no retrieved records at all gets one query rewrite and a second retrieval pass, since it may be Romanised Telugu. Summaries and recent turns resolve references, but only retrieved records count as evidence.

## Shared family recall

Each conversation keeps a rolling English summary (`conversations.summary_en`) with a version number and a cursor (`summary_through_message_id`, `summary_through_at`). `family_memories` holds what Gurtu can recall across chats in a household:

- `saved_memory` rows: the English interpretation and embedding of a saved `memories` row, keeping the original words.
- `conversation` rows: durable facts, plans, decisions and completed actions a family member stated in a chat, as one English sentence each, with who shared it, when, tagged people, optional occurrence dates with precision, and source message IDs. The chat text itself is not copied.

Triggers queue work in `memory_index_jobs` when a reply or a memory is saved. After `process-message` replies, it processes up to two of the caller's own jobs in the background (`EdgeRuntime.waitUntil`). A conversation job sends the previous summary, up to thirty new messages, twelve recent household memories and the family directory to one extraction call (`gurtu_conversation_memory`, reasoning effort `low`). The result is validated in code: memories must come from the family member's own non-question messages; dates must be real; update targets must be among the supplied memories. Embeddings use `text-embedding-3-small` at 1536 dimensions. `apply_gurtu_conversation_index` then writes the summary, the new memories and status updates (an older plan becomes `completed` or `superseded`, with a link) in one transaction, guarded by the summary version. A failed job stays queued and is retried on the user's next message. Original messages are never changed.

## Household vocabulary

`household_vocabulary` maps an alias (nickname, Telugu or Romanised spelling, abbreviation, local word) to one canonical term per household, with an entity type (person, crop, product, equipment, supplier, location, expression, abbreviation) and a status:

- **Taught in chat.** "Ramu and Ramesh are the same person" or "పత్తి అంటే cotton" is a `teach_vocabulary` action, saved as confirmed by `teach_gurtu_vocabulary` (idempotent per request). A person entry links to the family directory only on an exact, unique name match. If an alias already has another confirmed meaning, Gurtu asks before replacing it (Yes, proceed / Keep it). "X is not Y" records a rejected pair.
- **Learned from use.** Background chat indexing may return spellings the family member actually wrote; code keeps a spelling only if it appears word for word in that person's message. Non-person terms become confirmed once seen in two different messages. Person names stay suggestions until someone states the link, so identities are never merged on spelling alone. Rejected pairs and aliases with another confirmed meaning are never suggested.

Confirmed vocabulary is used, in small relevant subsets only:
- **Interpretation:** "alias = meaning" lines for terms in the message; confirmed person aliases also tag the right person.
- **Questions:** canonical terms for aliases in the question widen keyword and vector search, and the answer step is told the mapping.
- **Recall extraction:** known terms and person aliases.
- **Voice transcription:** up to 40 hints. Terms from the current chat's summary come first, then family names, then recent terms. The prompt says to use a spelling only if the word is actually spoken.

There is no separate vocabulary screen; it works behind the existing chat.

## Farm Kharchu and connected tasks

Money is recorded by talking to Gurtu. A message that moves money, plans work or corrects an entry becomes one `family_plan` action with an ordered list of operations: `create_task`, `complete_task`, `create_event`, `ledger_entry`, `allocation`, `correct_entry`, `void_entry`.

1. Before interpreting, `capture.ts` loads short numbered lists: open tasks, cash handed over and not yet accounted for, planned payments and estimates, and recent entries. The model points at existing records only by those numbers, and links new operations with refs such as `t1` or `h1`.
2. `plan.ts` resolves numbers to real IDs and amounts to integer paise. It validates dates; a message with no date gets the household-local receipt date, and an approximate range is kept as a range. Planned payments keep a due date. It checks that allocations plus returned cash fit the money handed over, and turns anything unclear into one question in the user's language. Undo and likely duplicate payments are confirmed first (Yes, proceed / Keep it). It writes the deterministic reply.
3. `apply_gurtu_family_plan` applies every operation in one transaction, once per request ID (`family_plan_runs`), re-checking each record against the caller's household. A deferred constraint trigger enforces that allocations plus returns never exceed a handover.

Ledger rules (`ledger_entries`):
- Every entry has a nature (income, operating expense, personal payment, loan received, loan principal repayment, interest, cash handover, cash returned, adjustment), a direction derived from it, and a status (actual, planned, estimate).
- People and businesses are `ledger_parties`, resolved through confirmed vocabulary aliases. Categories are created as used.
- A handover is one money-out row. `ledger_allocations` classify what it was spent on and are not extra cash; money given back is a `cash_returned` row.
- Corrections and undo keep the previous values in `ledger_entry_history`; undo is refused while dependent records exist.

`get_gurtu_ledger_report` calculates every total in SQL, counting only actual, non-voided rows. It separates cash flow from income and expenses, keeps loans and principal apart, and lists open handovers and planned payments. An approximate range that crosses the period edge is reported as uncertain, not counted. Money questions in chat receive these totals and matching entries as evidence, and the answer step is told not to recompute them.

Tasks are list items with optional `due_on` and `completed_at`; events and ledger rows can link to a task. The Calendar page shows due tasks and payments due from their own records, never as copied events. The Farm Kharchu page (`/farm-kharchu`) shows totals for this month, last month, this year or all time, what is still to settle, spending by category and person, and the entries.

## Time and events

Events store UTC `starts_at` and `ends_at` plus the target household's IANA time zone. Local wall times are converted with Temporal's `disambiguation: reject`, so nonexistent or repeated daylight-saving times need a correction. All-day events use local midnight through the next local midnight.

The home screen fetches events that have not ended, then applies `now >= starts_at - 24 hours && now < ends_at` locally. It schedules one local timer for the next start-window or end boundary and refreshes when the page regains focus. There are no cron jobs, notifications, reminders, or background polling.
