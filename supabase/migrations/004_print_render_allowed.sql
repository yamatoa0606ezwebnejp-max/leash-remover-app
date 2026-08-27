-- Let a paid-for render be retried after the response was lost.
--
-- 003 made charging idempotent on a request_id so that a dropped connection could not
-- take a credit and hand back nothing. Measured against the deployed service on
-- 2026-08-28, it did not hold: the rendering service asks for the balance *before*
-- starting the GPU, to avoid burning a render it cannot charge for, and by the time the
-- client retries that balance is zero. The retry is refused with 402 and the ledger it
-- would have matched is never consulted.
--
-- The check has to know about the request, not just the balance. A retry of something
-- already paid for is allowed through; a fresh request with no balance is not.
--
-- Run in the Supabase Dashboard SQL Editor after 003_server_side_authz.sql.

create or replace function public.print_render_allowed(
  p_user_id uuid,
  p_request_id uuid
) returns boolean
language sql security definer set search_path = public
as $$
  select
    coalesce((select balance from public.credits where user_id = p_user_id), 0) > 0
    or exists (
      -- Scoped to the user as well as the request. Without that, knowing somebody
      -- else's request_id would be enough to get a render without a credit.
      select 1 from public.consumed_render_requests
       where request_id = p_request_id and user_id = p_user_id
    )
$$;

revoke all on function public.print_render_allowed(uuid, uuid) from public;
grant execute on function public.print_render_allowed(uuid, uuid) to leash_api;
