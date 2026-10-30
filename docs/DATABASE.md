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

The pgTAP household tests in `supabase/tests/rls_household_isolation.test.sql` create synthetic users for all three households, then verify memory isolation, family identity visibility, explicit list/event access, and attempts to change an account's household.
