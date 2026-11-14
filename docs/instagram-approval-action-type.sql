alter table public.approval_requests
  drop constraint if exists approval_requests_action_type_check;

alter table public.approval_requests
  add constraint approval_requests_action_type_check
  check (action_type = any (array[
    'publish'::text,
    'send'::text,
    'purchase'::text,
    'spend'::text,
    'delete'::text,
    'account_change'::text,
    'deploy'::text,
    'other'::text,
    'instagram_reel_publish'::text
  ]));
