# Security and privacy

## Credentials

- `.env` and all `.env.*` files are ignored. `.env.example` contains placeholders only.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` may enter the browser build.
- `SUPABASE_SECRET_KEY` is used only by the local, interactive provisioning script. It is never in the frontend or GitHub source.
- `OPENAI_API_KEY` is sent only to Supabase Edge Function secrets by `npm run secrets:push`. That script creates a temporary mode-0600 file containing only the OpenAI values, uploads it with Supabase CLI, and removes the file.
- Cloudflare credentials stay local for Cloudflare account actions. Do not store them in GitHub Actions or Cloudflare frontend build variables unless you intentionally establish a separate CI deployment design.
- Rotate any credential that was exposed outside its intended account. Never paste production keys into source, issue text, screenshots, or logs.

## Household access

RLS, rather than route visibility, defines access. The household ID comes from the user's protected profile. Client roles cannot insert or update profiles, people, records, access grants, activity, idempotency entries, or rate-limit rows directly. RPCs re-derive the current household and validate people, lists, events, and IDs before writing.

People names and aliases are readable by all authenticated users in the family because they are needed for tags. A person tag never grants access to the memory. Sharing a list or event adds access only to that record. Event recipients have read-only access.

The SQL RLS suite uses synthetic fixture accounts. Do not run `supabase test db` with a production database URL; use a local Supabase stack only.

## Audio and AI

The browser keeps audio only in active MediaRecorder chunks and a temporary Blob. It sends the Blob in memory to an authenticated Edge Function; the function builds an in-memory multipart request to OpenAI and clears local references and byte buffers after completion. Gurtu does not create an audio table, use Storage for audio, or place audio in logs, browser persistence, or Git.

OpenAI processes the recording for transcription. Third-party processing and retention depend on the account's current API terms and controls; Gurtu does not claim that OpenAI retains no request data. Corrected transcript text is saved only after the user reviews and confirms an action. Ask questions are not stored as conversations.

Ask first retrieves permitted records and sends only a small ranked set to OpenAI. Answers without permitted source IDs are replaced with a not-found response.

## Backups and recovery

Supabase's current Free plan does not include automatic database backups. Supabase recommends that Free projects export data with the CLI and keep off-site backups. Confirm the plan and retention details in the [current Supabase backup documentation](https://supabase.com/docs/guides/platform/backups) before relying on the project for irreplaceable family records.

After production setup, make a logical export of the `public` schema and its data to an encrypted location outside this repository. Restrict the backup directory to the owner (`0700`) and each export to owner read/write (`0600`). Keep a second encrypted off-site copy. Do not put exports in GitHub, the project workspace, cloud-synced unencrypted folders, or issue attachments. A family restore requires the schema, application rows, working Auth accounts, and the relevant project settings; rehearse restoration with a separate test project before relying on it.

## Known limits

- OpenAI answers depend on the retrieval terms and up to twelve matching records; Telugu tokenization and mixed-language synonym matching need family testing.
- Production CORS, Auth redirect URLs, public sign-up settings, and custom domain values must be set once the Pages URL is known.
- A Supabase Free project currently has no automatic backup and may pause after a week of inactivity. Assess current platform limits and the family's recovery needs before launch.
