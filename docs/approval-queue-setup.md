# Secure approval storage setup

The application currently prepares proposals only. This database schema is a preparation step; it does not activate an approval API or execute external actions.

## 1. Create a dedicated Supabase project

Create a Supabase project and keep its database credentials private. Do not paste keys into chat, GitHub files, browser JavaScript, or screenshots.

## 2. Create the table

Open the Supabase project → SQL Editor → New query. Copy the complete contents of [supabase-approval-schema.sql](./supabase-approval-schema.sql), run it, and confirm that `public.approval_requests` exists.

The schema:
- stores a proposal title, action type, JSON payload, status, and timestamps;
- restricts reads and decisions to the signed-in owner through Row Level Security;
- permits a pending request to be decided once;
- makes the proposed action details immutable after creation;
- keeps decision records for audit and intentionally has no delete policy.

## 3. Configuration required before backend integration

The backend integration must validate a Supabase user access token with Supabase Auth and compare the returned user ID with a server-side owner ID allowlist. Only then may it use a server-side service-role key to read or write approval records.

Expected Render environment settings for that future integration:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never expose to the browser)
- `SUPABASE_OWNER_USER_ID`

Do not add these values to GitHub. Set them only in Render's private environment settings after the backend integration is reviewed.

## 4. Security boundary

An approval record means only that the owner approved a proposal. It must not itself trigger publishing, spending, sending, deletion, account changes, or deployment. Each external-action adapter must have its own explicit allowlist, validation, audit trail, and confirmation step. Until those are separately implemented and tested, the system remains proposal-only.

## 5. Verification checklist

- [ ] Supabase Auth user created for the owner.
- [ ] SQL executed successfully.
- [ ] RLS is enabled on `approval_requests`.
- [ ] Anonymous users cannot read or decide records.
- [ ] The owner can create and read their own requests.
- [ ] A request can transition from pending to approved or rejected exactly once.
- [ ] Another user cannot read or decide the owner's records.
- [ ] No external action is run by approving a record.
