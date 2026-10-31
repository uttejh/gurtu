# Family setup

The family is provisioned with three private households and six people. The parents share one login, but Mom and Dad stay separate people so each can be tagged independently.

| Household | Login accounts | Time zone |
| --- | --- | --- |
| Parents | One shared account for both parents | `Asia/Kolkata` |
| Household 2 (`chinnodu`) | Chinna and Ash each have a login | `America/Toronto` |
| Household 3 (`peddodu`) | Nani and Sush each have a login | `America/Chicago` |

## Before provisioning a new family

1. Ask each account owner which email and password they will use. The script accepts passwords privately at the terminal and displays `*` characters instead of the password.
2. Decide the names shown in the people directory. Mom and Dad should be different people even though they share a login.
3. Ask the family which nicknames and Telugu aliases should be recognized. The script begins Mom and Dad with Mom/Amma/అమ్మ and Dad/Nanna/నాన్న; add other aliases only after confirming them.
4. Obtain each household's IANA time zone. `IST` normalizes to `Asia/Kolkata`; `CST`, `CDT`, and `CT` normalize to `America/Chicago`.
5. Apply database migrations and put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the local ignored `.env`.

## Provision a new family

```sh
npm run provision:family
```

The script asks for a family name, household labels, five unique login emails and passwords, six identity names and aliases, and both household time zones. It normalizes common abbreviations before creating Auth users, then calls a restricted database function to create the family, households, profiles, people, and administrator role in one transaction. Chinna must use `chinna@gurtu.com`; he receives the only administrator role and stays in Household 2.

When Chinna opens Family Activity after setup, Gurtu prompts him to enroll a TOTP authenticator. Other family accounts do not need MFA for normal household use.

The first family setup is complete. Do not run it again in this project unless you intend to create a second family. If a future setup fails, the script removes only Auth users created during that run. It does not add sample family data.

## What members can see

Each household's memories and item locations remain private to that household. Family members can see names and aliases to tag each other. A list can be shared with a selected person's household; a calendar event can be shared with the selected person's household. Sharing either record does not expose that household's memories or unrelated events/lists.
