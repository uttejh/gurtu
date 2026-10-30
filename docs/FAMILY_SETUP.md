# Family setup

Gurtu starts with three private households and six people. The parents share one login, but Mom and Dad stay separate people so each can be tagged independently.

| Household | Login accounts | Time zone |
| --- | --- | --- |
| Parents | One shared account for both parents | `Asia/Kolkata` |
| Household 2 (Chinna and Ash) | Chinna and Ash each have a login | Enter the correct IANA zone |
| Household 3 (Nani and Sush) | Nani and Sush each have a login | Enter the correct IANA zone; do not guess it |

## Before running setup

1. Ask each account owner which email and password they will use. The script accepts passwords privately at the terminal and displays `*` characters instead of the password.
2. Decide the names shown in the people directory. Mom and Dad should be different people even though they share a login.
3. Ask the family which nicknames and Telugu aliases should be recognized. The script begins Mom and Dad with Mom/Amma/అమ్మ and Dad/Nanna/నాన్న; add other aliases only after confirming them.
4. Obtain the correct IANA time zones for the two other households. Examples include `America/Toronto` and `America/Los_Angeles`; these examples are not assumptions about your family.
5. Apply database migrations and put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the local ignored `.env`.

## Run once

```sh
npm run provision:family
```

The script asks for a family name, household labels, five unique login emails and passwords, six identity names and aliases, and both unknown time zones. It checks that the time zones are valid IANA names. Chinna's login must use `chinna@gurtu.com`; the trusted database provisioner assigns the global administrator role to that Auth identity while keeping Chinna in Household 2. It creates the Auth users, then calls a restricted database function to create the family, households, profiles, people, and administrator role in one transaction.

When Chinna opens Family Activity after setup, Gurtu prompts him to enroll a TOTP authenticator. Other family accounts do not need MFA for normal household use.

If any part fails, the script removes only Auth users it created during that run. It does not add sample family memories or events. Do not run setup again after it completes unless you intend to create a second family.

## What members can see

Each household's memories and item locations remain private to that household. Family members can see names and aliases to tag each other. A list can be shared with a selected person's household; a calendar event can be shared with the selected person's household. Sharing either record does not expose that household's memories or unrelated events/lists.
