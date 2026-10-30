# Deployment checklist

This checkout contains the app, migrations, Edge Functions, and deployment settings. It has not been deployed: the Supabase project URL and publishable key are not present, no Pages URL exists yet, and household accounts and two household time zones must be supplied during setup.

## 1. Prepare local configuration

Add these values to the ignored `.env` after obtaining them from the Supabase project:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

The secret key is for the local provisioning script only. Keep the browser key on the `VITE_` variable, and never add the secret key to a `VITE_` variable. The supplied Cloudflare and OpenAI credentials are already held in the local ignored file; they are not in this repository.

## 2. Create and configure Supabase

1. Create or choose a Supabase project on the Free plan if it meets the family's needs. This app does not upgrade a plan.
2. Copy the project URL, publishable key, and secret key into the local `.env` variables above.
3. Configure email/password Auth. Disable public sign-ups. Add the eventual production Pages URL and `https://YOUR_PAGES_HOST/reset-password` to allowed redirect URLs.
4. Authenticate the CLI and apply migrations:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

5. Run local RLS tests against a local stack before using the hosted project: `supabase start` then `supabase test db`.
6. Deploy the functions:

   ```sh
   supabase functions deploy transcribe-audio
   supabase functions deploy process-memory-input
   supabase functions deploy ask-memory
   ```

7. Set `APP_ORIGINS` in `.env` to the exact deployed site origin when known, then run `npm run secrets:push`. The upload includes only OpenAI key/model values and `APP_ORIGINS`.
8. Confirm function JWT verification remains enabled and verify production functions accept an authenticated Supabase session only.

## 3. Create the family accounts and directory

After migrations are applied and `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are configured, run:

```sh
npm run provision:family
```

The interactive script creates five email/password Auth users, one shared profile for the parents' login, two profiles for your household, and two profiles for your brother's household. It creates six people as separate identities. It asks for login emails/passwords, identity names, optional aliases, and both non-India IANA time zones. It defaults only Mom/Dad aliases supplied in the brief and the parents' known `Asia/Kolkata` zone. It masks password entry and never writes passwords to disk.

Confirm all six person names and alias lists before provision. If setup fails after creating new Auth users, the script removes only the users created by that run.

## 4. Connect private GitHub source to Cloudflare Pages

Once the private `gurtu` repository exists and has the app source:

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Import an existing Git repository** and authorize the GitHub repository.
2. Select `gurtu` and use production branch `main`.
3. Set build command `npm run build`; output directory `dist`; root directory `/`.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the production and preview build environments.
5. Do not add `OPENAI_API_KEY` or `SUPABASE_SECRET_KEY` to Pages build variables.
6. Deploy and verify the generated `https://*.pages.dev` URL, `/login`, password reset redirect, and protected route behavior. Add that exact origin to Supabase Auth redirect URLs and Edge Function `APP_ORIGINS`.

Cloudflare's current Pages docs list Vite's build command and output directory as `npm run build` and `dist`; the repository includes `_redirects` for the SPA. See [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/) and [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## 5. Smoke test and backup

- Test the five logins, including the same shared parents account on two devices.
- Confirm a memory saved by one household cannot be read by another; confirm only a specifically shared list or event crosses a household boundary.
- Test a Telugu, English, and mixed-language clip with consent and verify the transcript before saving.
- Create an event in each household's configured zone and check daylight-saving transitions.
- Export the `public` schema and data to an encrypted location outside the repository. Review [backup limits and procedure](SECURITY.md#backups-and-recovery); Free projects do not have automatic backups.
