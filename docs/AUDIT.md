# Gurtu audit against the master specification (Stage 0)

Audit date: 4 November 2026. Compared against `04_GURTU_MASTER_ENGINEERING_SPECIFICATION.md`. This document describes the code in this repository after the Stage 1 change; it is not a claim that the target specification is met.

## 1. Actual architecture

```text
React SPA (Cloudflare Pages)
  ├─ direct reads under the user's JWT (RLS): conversations, talk_messages, memories,
  │  lists, events, activity_log, people, profiles
  ├─ list/calendar page writes → user-scoped RPCs (create_gurtu_list, change_gurtu_list_item, …)
  └─ chat → Edge Function process-message
                 ├─ start_gurtu_message (save words first, idempotent)
                 ├─ _shared/intent.ts  question or action?
                 ├─ _shared/ask.ts      keyword retrieval + grounded answer (OpenAI)
                 ├─ _shared/capture.ts  interpret (OpenAI) → capture_requests → RPC execute
                 └─ record_gurtu_reply (exactly one reply)
Edge Function transcribe-audio → OpenAI transcription (audio held in memory only)
Edge Functions ask-memory, process-memory-input → thin wrappers kept for older app versions
Supabase Postgres: RLS on every application table; household helpers derive scope from auth.uid()
```

## 2. Feature matrix

| Area (spec section) | Status | Notes |
|---|---|---|
| One orchestrator (§5) | **Partially implemented** | `process-message` is the single chat entry point. Routing between question and action is still a deterministic regex, not a single structured interpretation. |
| Save original message before AI (§5, §47) | **Implemented** | `start_gurtu_message`, verified by local end-to-end tests. |
| Request idempotency (§35) | **Implemented** | Per-login `client_message_id`; one reply per message; capture `request_id`; RPC `operation_requests`. |
| Operation status tracking (§48) | **Partially implemented** | `capture_requests` tracks one operation per message. No multi-operation batches. |
| Known defect "2,000 characters" (§58) | **Fixed** | Root cause: the app sent up to 12 turns × 500 characters and `ask-memory` accepted 4 × 300; every validation failure showed the length message. Fixed server-side; `process-message` returns specific empty / too-long / unreadable errors. |
| Calendar period questions (§25) | **Implemented** (events only) | Household-local half-open ranges for today, tomorrow, this/next week, this/next month. Dated tasks do not exist yet. |
| Separate conversations, New/Continue chat (§55) | **Implemented** | Automatic titles from the first message. Existing history moved to one "Earlier chat" per login. |
| Rolling conversation summaries (§10B) | **Missing** | Stage 2. |
| Shared family recall, pgvector, hybrid search (§10C, §12) | **Missing** | Keyword `ilike` search plus a 4-topic Telugu alias table. Stage 2. |
| Family vocabulary (§15–18) | **Partially implemented** | People aliases only, sent as transcription hints. |
| Cross-module links, dated tasks (§19–20) | **Missing** | List items have no due date; no links between modules. |
| Farm Kharchu ledger (§26–34) | **Missing** | Stages 4–5. |
| Duplicate warnings, corrections, undo (§36–38) | **Missing** | Admin people/location corrections only. |
| Evidence-backed answers (§40) | **Partially implemented** | Answers cite retrieved source IDs; no timelines or catch-up. |
| Visual theme (§54) | **Mostly implemented** | Black base; a blue `--accent` token remains; sizes not yet measured on devices. |
| Streaming (§53) | **Missing** | A "thinking" indicator only. |

## 3. Data relationships (current)

```text
families 1─* households 1─* profiles (1 per auth user)
families 1─* people (aliases, home_household_id)
households 1─* memories *─* people (memory_people)
households 1─* items 1─* item_location_history ─ source memory
households 1─* lists 1─* list_items; lists *─* people; lists *─* households (list_household_access)
households 1─* events *─* people; events *─* households (event_household_access)
auth user 1─* conversations 1─* talk_messages (reply_to_message_id → talk_messages)
auth user 1─* capture_requests (request_id = chat client_message_id)
auth user 1─* operation_requests (idempotency for every write RPC)
households 1─* activity_log; families 1─* admin_audit_log
```

## 4. Defects found and fixed during this audit

1. Browser schema rejected `update_list_item` / `remove_list_item` proposals (missing `people_mentions`).
2. `ask-memory` rejected normal chat context (the "2,000 characters" defect).
3. List item updates and removals only searched the first two items of a list.
4. Multi-item removal retries could skip items (index-based request IDs).
5. Moving an event reset its duration to one hour (chat and calendar edit).
6. Event deletion only considered three events with the same title.
7. AI calendar hints listed the oldest events, and only for deletions.
8. CORS allowed every `*.pages.dev` site.
9. Lists page could stay disabled; success notices showed in the error tone.
10. History showed every household to the administrator; deleted events had no label.
11. Family Activity re-logged "capture viewed" on every reload.
12. `supabase/tests/rls_household_isolation.test.sql` was stale after the 30 Oct privacy migration and failed; updated to the current privacy design.
13. "Do I have any events this month" without a question mark was treated as a save.

## 5. Security gaps (open)

| Gap | Risk | Plan |
|---|---|---|
| Older app versions can still insert `talk_messages` directly. | Low: a user can only add rows to their own chats; ownership and receipt time are enforced by trigger. | Revoke the insert grant in the Stage 2 migration, after the new app version has been live for a while. |
| Administrator reads of memories, lists and events at `aal2` use RLS policies and are not individually audited. Only capture views and searches are logged. | Medium for §46 ("explicit audited server-side paths"). | Move administrator household reads behind audited RPCs before adding Farm Kharchu data. |
| `src/lib/actions.ts` duplicates the server proposal schema. | Drift caused defect 1. | Remove once no browser code needs it (unused by the app since Stage 1; still covered by its unit test). |
| Model IDs `gpt-6-luna` and `gpt-transcribe` are configured but were not verified in this audit. | Medium. | Verify against the OpenAI account before Stage 2 adds embeddings. |
| Edge functions have no automated tests in CI. | Medium. | The local end-to-end script used for Stage 1 should become a repository test once a CI runner with Docker is available. |

## 6. Performance notes

- Structured JSON timings are logged per stage (`process_message_stage`, `database_query`, `openai_call`). There is no P50/P95 aggregation yet.
- A typical action uses one model call. A question uses one model call when the first keyword search answers it, and up to three sequential rounds otherwise (grounded answer → term expansion plus general answer in parallel → grounded answer). Stage 2 should replace this with retrieval-first hybrid search and one answer call.
- Chat context is read from the database (indexed by `conversation_id, created_at`) and capped at 12 turns.

## 7. Migration plan and risks

| Stage | Migration | Risk | Rollback |
|---|---|---|---|
| 1 (this change) | `20261104000100_conversations.sql`: new `conversations`, new columns on `talk_messages`, backfill into "Earlier chat", three RPCs, one trigger. Additive; no rows deleted. | `conversation_id` becomes NOT NULL; the migration fails safely if a message's author has no profile. | Drop the trigger, RPCs and new columns; drop `conversations`. The older app version keeps working against the old columns. |
| 2 | Summaries on `conversations`; `family_memories` with a fixed-dimension pgvector column; an indexing work table; revoke legacy `talk_messages` inserts. | Embedding model and dimension choice; privacy change to household-shared recall. | Versioned index; feature can be disabled without data loss. |
| 3 | Household vocabulary table. | Wrong merges of similar names. | Confirmation status; aliases are additive. |
| 4–5 | Due dates on list items; ledger, categories, handovers, allocations, links; atomic multi-operation RPCs. | Financial correctness. | Integer paise, database checks, and invariant tests before production. |
| 6–7 | Corrections, undo, timelines, catch-up. | Privacy of catch-up summaries. | Read-only features over existing records. |

Every migration is tested on a local Supabase stack (`supabase start`, `supabase test db`, end-to-end checks) before it is applied to production.
