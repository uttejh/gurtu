# Database reference

All migrations live under `supabase/migrations/`. Every table below has RLS enabled. Regular data writes run through a user-scoped RPC; no application function uses a service key for family data.

## Tables

| Table | Purpose | Access rule |
| --- | --- | --- |
| `families` | A Gurtu family. | Read by members of that family. |
| `households` | A family household and its IANA time zone. | Read by members of that family. |
| `profiles` | Maps one Auth user to one family, household, and display name. | User can read their own row. Clients cannot write it or change household. |
| `people` | Family-wide names, aliases, and home household. | Family members can read identities; clients cannot edit the directory. |
| `memories` | Original text, detected language, optional summary, creator, and household. | Private to the owning household. |
| `memory_people` | People tags for a memory. | Follows the memory household; person must be in the same family. |
| `items` | Household-owned canonical item name. | Private to the owning household. |
| `item_people` | People tags for an item. | Follows the item household. |
| `item_location_history` | Append-only location reports with author and time. | Private to the owning household; source memory stays in that household. |
| `lists` | Household-owned list title and creator. | Owner household by default; explicit household access may expose one list. |
| `list_items` | Text, completion state, ordering, author, and idempotency key. | Follows access to its parent list. |
| `list_people` | People tags for a list. | Follows access to its parent list. |
| `list_household_access` | Explicit list-to-recipient-household grant. | Readable only by households already allowed to see the list; write access is RPC-only. |
| `events` | Owner, title, UTC bounds, IANA time zone, and all-day flag. | Owner household plus specifically granted recipient households; only owner can edit. |
| `event_people` | People tags for an event. | Follows event access. |
| `event_household_access` | Explicit event-to-recipient-household grant. | Readable only by households already allowed to see the event; write access is RPC-only. |
| `activity_log` | Minimal action name, actor, record reference, household, and timestamp. | Readable by the household that performed the action. It does not copy private source text. |
| `operation_requests` | Per-user idempotency keys for memory, location, list, and event changes. | No direct API access. RPC-only. |
| `api_rate_limits` | Per-user request counts in short time windows. | No direct API access. Rate-limit RPC only. |
| `capture_requests` | Original/corrected Remember text, validated interpretation, processing status, safe failure, and result ID. Audio is never stored. | Submitter can read their own capture. The global administrator can review family captures only at `aal2`. Writes use narrow RPCs. |
| `admin_audit_log` | Administrative search/view, retry, and correction history with previous/new values and reason. | Readable by the global administrator at `aal2`; protected from direct client writes and deletes. |
| `private.global_administrators` | Trusted server-controlled administrator identities. | Private schema; no direct client access. Provisioning assigns the role. |
| `conversations` | One chat: owner login, household, automatic title, last activity time, and its rolling English summary with version and cursor. | Owner login only. Created by `start_gurtu_message`; clients cannot edit it. |
| `talk_messages` | Chat messages with server receipt time, per-login `client_message_id` (idempotency), `reply_to_message_id` (one reply per message), input type, language and metadata. | Owner login only. Saved by `start_gurtu_message` / `record_gurtu_reply`; a trigger checks ownership for direct inserts. |
| `family_memories` | Household recall: English interpretation, embedding (`vector(1536)`), type, status, superseded link, people, occurrence dates and precision, who shared it, and source references. Saved-memory rows keep the original words; chat-derived rows keep only source message IDs. | Readable by the owning household only, including by the administrator. Written only by the indexing RPCs. |
| `memory_index_jobs` | Durable queue of summary and recall indexing work, with attempts and safe error text. | No direct API access. Each login claims and completes only its own jobs through RPCs. |
| `household_vocabulary` | Alias → canonical term per household, with normalised keys, script, entity type, optional family person link, status (suggested, confirmed, rejected) and the distinct source messages that suggested it. | Readable by the owning household only, including by the administrator. Written only by `teach_gurtu_vocabulary` and the indexing RPC. |
| `ledger_entries` | Farm Kharchu entries: nature, direction, status (actual, planned, estimate), integer `amount_paise`, description, original words, occurrence range with precision, due date, party, category, quantity and unit, links to task, event, handover or the planned payment it fulfils, source message, request ID, void marker. | Household only. Written only by `apply_gurtu_family_plan`. |
| `ledger_allocations` | What part of a cash handover was used for (farm or household purchase, personal, wage advance applied, other). Not a cash movement. | Household only. A deferred trigger keeps allocations plus returns within the handover. |
| `ledger_parties`, `ledger_categories` | Workers, drivers, mechanics, suppliers, banks, landlords and buyers; user-created categories. Unique by normalised name. | Household only. |
| `ledger_entry_history` | Previous and new values for every correction or undo, with actor, time, reason and source message. | Household only. |
| `family_plan_runs` | One result per login and request ID, so a retried message never applies twice. | No direct access. |

## Important relationships and indexes

- `profiles.household_id` is constrained to the profile's `family_id`; one Auth user has one profile.
- A memory can be tagged to people in another household without sharing the memory.
- An item has one household-local canonical name. Its location history keeps older reports; the newest entry is the current reported location.
- A list's owner household always retains access. `list_household_access` adds only the named household for that list.
- An event's owner household always retains edit access. `event_household_access` adds read access for that event only.
- Indexes cover family membership, people names, household/date records, reverse person-tag lookups, latest item locations, list ordering, event start/end times, and history dates. Memories also have a simple-language full-text GIN index for future query paths.

## Write RPCs

- `save_gurtu_memory` stores the corrected original text, language, summary, people tags, and one activity row.
- `save_gurtu_item_location` stores the source words, household-local item, people tags, latest location history, and activity row.
- `create_gurtu_list` creates the list, people tags, initial items, per-recipient household access, and activity row.
- `change_gurtu_list_item` adds, completes, uncompletes, or removes one item and records activity.
- `create_gurtu_event` creates the event, people tags, explicit recipient household access, and activity row.
- `update_gurtu_event` updates owner-household events and records activity.
- `consume_gurtu_rate_limit` applies fixed account-level caps for AI interpretation, Ask, and transcription.
- `provision_gurtu_family` is restricted to the trusted `service_role` setup process.
- `create_gurtu_capture_request`, `update_gurtu_capture_interpretation`, `confirm_gurtu_capture_operation`, `fail_gurtu_capture`, and `finish_gurtu_capture` maintain the text-only Remember lifecycle.
- `admin_retry_gurtu_capture` retries only safe, idempotent memory, item-location, and list creation actions. It reconciles an already-written result instead of duplicating it.
- `admin_correct_capture_people` updates a tagged association and audits the old/new values. `admin_correct_capture_location` preserves old history and appends a corrected location.

The pgTAP household tests in `supabase/tests/rls_household_isolation.test.sql` use five synthetic Auth identities across three households. They verify household isolation, the AAL2 administrator boundary, record and association visibility, failed capture review, retry idempotency, correction auditing, no audio/credential columns, and attempts to self-assign an administrator role.


`list_items` also has `due_on` and `completed_at` (set by trigger); `events` has `related_list_item_id`.
