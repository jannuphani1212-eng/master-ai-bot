# Secure approval storage setup

The backend now includes owner-authenticated approval API routes. The API records proposals and decisions only; it does not execute external actions. The database schema and private server configuration below must still be completed before the API becomes available.

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

## 3. Configure the backend on Render

The backend validates the supplied Supabase user access token with Supabase Auth and compares the returned user ID with SUPABASE_OWNER_USER_ID. It then accesses the table with the public anon key and that same user access token, so Supabase Row Level Security remains active. A service-role key is not needed and must not be added for this feature.

Expected Render environment settings for that future integration:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_OWNER_USER_ID`

Do not add these values to GitHub or send them in chat. Set them only in Render's private environment settings. Never expose any private key.

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

## 6. API contract

All routes require Authorization: Bearer <Supabase access token>.

- GET /api/approvals lists up to 100 newest owner proposals.
- POST /api/approvals accepts { "title": "...", "actionType": "publish", "payload": {} }.
- PATCH /api/approvals/:id/decision accepts { "status": "approved" } or { "status": "rejected", "decisionNote": "..." }.

A decision is conditional on the record still being pending. The database trigger records the decision time and authenticated user. No publishing, spending, sending, deletion, account change, or deployment is triggered.
