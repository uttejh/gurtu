# Gurtu Application Design

## Product

Gurtu (గుర్తు) is a private family memory notebook for three households. People can preserve Telugu, English, and Telugu-English memories by voice or text, then retrieve them through grounded questions. The product stays within the nine capabilities in the supplied master prompt: memories, people tags, item locations and location history, simple lists, events/calendar, upcoming events, memories/history views, and login/logout. It has no notification or separate reminder system, no public registration, and no family-wide access to private household data.

## Experience

The responsive React website follows the two supplied screenshots: black canvas, white main text, muted gray supporting text, charcoal surfaces, thin low-contrast borders, and large comfortable controls. The home page leads with “Remember something” and “Ask your memory”, followed by only events inside the 24-hour-before-start through event-end window. The login screen uses email/password and password recovery only. Inner pages retain a large Back action and simple navigation. Voice is optional; typed input remains available.

## Architecture

- React, Vite, TypeScript, React Router, Zod, and the Supabase JavaScript client form the static frontend.
- Supabase Auth restores email/password sessions. There is no sign-up route.
- Supabase PostgreSQL stores the relational family, household, profile, people, memory, item-location, list, event, access, and activity data. Every household-owned table has RLS. Person identity data is family-readable; private records are not.
- Supabase Edge Functions receive authenticated requests with a user-scoped database client. The AI returns schema-validated proposals only; backend code resolves people and records and applies a confirmed action. Ask retrieves permitted records first and gives the model only that evidence.
- OpenAI Responses API uses `gpt-6-luna` for structured interpretation and grounded answers. The audio transcription endpoint uses `gpt-transcribe`. Both IDs and the proposed endpoints are documented by OpenAI; the supplied API key’s model list includes both. The model IDs remain server-side configuration.
- Cloudflare Pages serves the static frontend from the private GitHub repository. Supabase Edge Functions remain the backend. There is no Cloudflare Worker/API proxy, PWA notification worker, cron job, or background reminder process.

## Data and privacy rules

Households own memories and items. Person tags do not alter ownership. Lists are private unless an explicit list-household access row grants one recipient household access. Events use their own explicit access rows; the creator household can edit, a recipient household can view, and neither access row grants access to other records. Event timestamps are UTC and retain the target household’s IANA zone. Home visibility is computed as `now >= starts_at - 24 hours AND now < ends_at`, with no scheduled work.

Voice recordings stay in temporary browser and request memory only. Audio is not stored in a database, object store, browser persistence, logs, or Git. Corrected transcript text is saved only after user confirmation. Idempotency keys prevent retried writes from creating duplicates. Questions are not stored as memories or conversation history.

## Open setup inputs

The implementation must not invent family names, login emails, passwords, aliases, or household time zones. `Asia/Kolkata` is known for the parents. The Supabase project URL and publishable key are still required for a functioning login and deployment. The other household time zones and five account identities are collected by the secure provisioning flow. Cloudflare and OpenAI credentials have been supplied locally; the Cloudflare token is active and OpenAI lists both requested models.

## Verification

Unit tests cover language-safe input, people-alias resolution, date-zone conversion, event visibility, and action validation. Supabase SQL tests cover all three household boundaries, explicit event/list sharing, and household-ID tampering. Browser tests cover auth gating, navigation, input/confirmation states, and accessibility-sized controls using synthetic data. Build, TypeScript, lint, secret-scan, and responsive visual comparison are run before handoff. Integration and production deployment checks that need missing Supabase configuration remain explicitly unverified until that configuration is supplied.
