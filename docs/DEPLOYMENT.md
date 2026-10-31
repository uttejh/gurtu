# Deployment checklist

The app source is in the private `poulrohan23/gurtu` repository. The Supabase project URL and publishable key are in the ignored local `.env`. Cloudflare Pages is live at [https://gurtu.pages.dev](https://gurtu.pages.dev). The Supabase migrations, Auth settings, three Edge Functions, OpenAI function secrets, and family accounts are deployed.

## 1. Prepare local configuration

Check the existing ignored `.env` before adding configuration. The Supabase URL and publishable key are already set locally; add any missing values without replacing existing keys:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

The secret key is for the local provisioning script only. Keep the browser key on the `VITE_` variable, and never add the secret key to a `VITE_` variable. The supplied Cloudflare and OpenAI credentials are also held only in the ignored local file; they are not in this repository.

## 2. Create and configure Supabase

The hosted project `hozmffrhhzwragtyafia` is linked in the local checkout. All four migrations are applied. The production Auth URL and recovery redirect are configured, public sign-up is disabled, and TOTP enrollment and verification are enabled. The three Edge Functions are active with JWT verification, and the OpenAI key, model names, and allowed origins are set as function secrets.

To apply future migrations and update functions:

```sh
supabase db push
supabase functions deploy transcribe-audio
supabase functions deploy process-memory-input
supabase functions deploy ask-memory
npm run secrets:push
```

The pgTAP suite passed against a temporary PostgreSQL 14 database. The official Supabase local stack could not be run because Docker was unavailable; run `supabase start` and `supabase test db` locally before future schema changes.

## 3. Create the family accounts and directory

After migrations are applied and `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are configured, run:

```sh
npm run provision:family
```

The family has three households, five logins and six people. Household zones are `Asia/Kolkata` for the parents, `America/Toronto` for Household 2, and `America/Chicago` for Household 3. Chinna's login is `chinna@gurtu.com`, receives the only global administrator role, and remains in Household 2. He enrolls a TOTP authenticator the first time he opens Family Activity.

The first family setup is complete; do not run it again unless you intend to create a second family. For later setup, the script normalizes common time-zone abbreviations to IANA names and prints database errors directly. If a future run fails after creating Auth users, it removes only users created during that run.

## 4. Cloudflare Pages deployment

Cloudflare Pages is connected to the private `poulrohan23/gurtu` repository and deploys `main` automatically. The project is configured with build command `npm run build`, output directory `dist`, root directory `/`, and the public Supabase URL and publishable key for production and preview builds. The production URL is [https://gurtu.pages.dev](https://gurtu.pages.dev); its first production build succeeded.

The browser has received only the Supabase URL and publishable key. Do not add `OPENAI_API_KEY` or `SUPABASE_SECRET_KEY` to Pages build variables. Supabase Auth already allows `https://gurtu.pages.dev` and `https://gurtu.pages.dev/reset-password`. The ignored local `.env` lists `https://gurtu.pages.dev` and `http://localhost:5173` in `APP_ORIGINS`; those origins are set as Edge Function secrets.

Cloudflare's current Pages docs list Vite's build command and output directory as `npm run build` and `dist`; the repository includes `_redirects` for the SPA. See [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/) and [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## 5. Smoke test and backup

- Test the five logins, including the same shared parents account on two devices.
- Confirm a memory saved by one household cannot be read by another; confirm only a specifically shared list or event crosses a household boundary.
- Confirm only Chinna sees Family Activity, and cross-household rows remain hidden until his authenticator session reaches AAL2.
- Review a failed capture, retry an eligible list once, and confirm a second retry cannot create another list. Check a tag and location correction in the audit trail.
- Test a Telugu, English, and mixed-language clip with consent and verify the transcript before saving.
- Create an event in each household's configured zone and check daylight-saving transitions.
- Export the `public` schema and data to an encrypted location outside the repository. Review [backup limits and procedure](SECURITY.md#backups-and-recovery); Free projects do not have automatic backups.
