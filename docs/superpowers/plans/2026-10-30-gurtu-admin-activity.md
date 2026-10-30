# Gurtu Global Administrator and Family Activity Plan

## Goal

Add a server-enforced global administrator for Chinna, preserve ordinary household isolation, and provide an audited Family Activity review and recovery workflow.

## Implementation order

1. Add a trusted global-role table, an AAL2-aware admin predicate, capture request records, and an immutable admin audit log. Add read-only administrator policies to each family-owned table without changing ordinary write policies.
2. Extend trusted family provisioning so `chinna@gurtu.com` is created in Household 2 and is the only account assigned the global role. Update the prompts and defaults for Chinna, Ash, Nani, and Sush.
3. Record text-only Remember something lifecycle events, including transcription receipt, interpretation, confirmation, success, failure, safe error details, and original/corrected transcript text. Preserve request idempotency.
4. Add secure administrator retry and correction RPCs. Restrict retries to failed eligible operations; use the submitter's identity and request id inside a transaction. Audit retries, transcript views, and corrections.
5. Add an admin-only Family Activity page with search and filters, detail review, MFA enrollment/challenge, retry, and audited tag/location corrections. The family nav only renders the link when the database says the signed-in user has the role.
6. Add regression coverage for the three-household/ five-identity security matrix, role assignment, capture lifecycle, no direct role mutation, idempotent retry, correction audit, and audio non-persistence. Run app checks and SQL checks where a local database is available.

## Security constraints

- No email comparison in browser code grants privileges. The provisioning function assigns the role using the trusted account identity and validates the household.
- The admin interface uses the authenticated Supabase client. RLS provides the broader read scope only for the trusted admin at AAL2.
- Ordinary household write policies remain unchanged. Admin writes go through narrow security-definer RPCs that validate role, assurance level, record family, and correction reason.
- Captures contain text and validated JSON only. They never store audio, prompts, credentials, hashes, or raw API errors.
- Retrying an already successful operation is rejected or reconciled through its original idempotency row; it never creates a second entity.

## External setup dependency

The Supabase project URL and publishable key are configured locally. Applying migrations and creating the five Auth identities still requires authenticated Supabase project access and the family-specific account details collected by the masked local provisioning script.
