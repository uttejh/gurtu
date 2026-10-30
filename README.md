# Gurtu (గుర్తు)

Gurtu is a private family memory notebook for three households. Family members can preserve Telugu, English, and mixed-language memories, remember where belongings were last reported, keep simple shared lists, manage appointments, and ask questions grounded in saved family records.

The home screen follows the supplied reference: two large actions, events inside their 24-hour display window, and links to lists, memories, history, and the calendar. There is no public registration, social feed, notification system, or chat history.

## Features

- Email and password login, logout, and password recovery through Supabase Auth.
- Type or speak a memory; review the proposed save and people tags before writing.
- Preserve original Telugu or English text. Item locations keep an append-only history.
- Ask questions using records retrieved under the signed-in household's database permissions; show the cited records with the answer.
- Create and update simple lists. A list can be shared with the home household of a selected family member.
- Create, update, and review events in their saved IANA time zone. Shared events grant event access only.
- Home visibility begins 24 hours before an event and ends at its end time. No scheduled reminder or polling job is used.
- Chinna can open the admin-only **Family Activity** review after authenticator MFA. It can inspect capture history across households, retry safe failed saves, and audit corrections.

## Stack

React, Vite, TypeScript, React Router, Supabase Auth/PostgreSQL/Edge Functions, OpenAI Responses and transcription APIs, and Cloudflare Pages. The browser only receives a Supabase publishable key. The OpenAI key and Supabase secret key remain server-side or in the local provisioning environment.

## Run locally

```sh
npm ci
cp -n .env.example .env
```

Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` to connect the browser. `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are used only by the trusted family provisioning script. Do not prefix a secret key with `VITE_`.

```sh
npm run dev
```

Without Supabase browser settings, login remains visible but clearly reports that setup is incomplete. To review the home design without connecting a database, open `/?preview=home` in development; that development-only preview uses synthetic sample event data.

## Verify and test

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The unit tests use synthetic values. The Supabase pgTAP suite uses disposable local database fixtures and must only run against a local test database:

```sh
supabase start
supabase test db
```

The SQL suite does not target or seed a linked production project. Browser and API integration tests that need configured family accounts are documented separately; no family credentials or data are included in tests.

## Backend setup

The schema and household policies are in `supabase/migrations/`. For a hosted project, configure Supabase CLI access, link the project, and apply the migrations before provisioning accounts:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Deploy the three user-authenticated functions:

```sh
supabase functions deploy transcribe-audio
supabase functions deploy process-memory-input
supabase functions deploy ask-memory
```

Add the OpenAI key as a Supabase Edge Function secret with `npm run secrets:push`. The script uploads only the OpenAI key, model names, and optional allowed origins from the ignored local `.env`; it removes its temporary restricted file afterward. It does not upload the Cloudflare token or Supabase secret key.

Use `npm run provision:family` after applying migrations. It asks for the five login emails and passwords, six identity names and aliases, and the two unknown household time zones. Passwords are masked. The parents' household is fixed to `Asia/Kolkata`.

Read [the deployment checklist](docs/DEPLOYMENT.md) before connecting family users. The supplied Supabase URL and publishable key are stored in the ignored local `.env`. The schema has not been applied, Auth accounts have not been provisioned, and the app has not been deployed to Cloudflare Pages.

## Deployment

Cloudflare Pages serves the static Vite output in `dist/`; Supabase remains the only application backend. Connect the private GitHub repository to Pages, set the build command to `npm run build`, set the output directory to `dist`, and add the two public `VITE_SUPABASE_*` variables in production and preview environments. The OpenAI key must never be a Cloudflare build variable. See [deployment](docs/DEPLOYMENT.md) for the remaining auth, function, and privacy setup.
