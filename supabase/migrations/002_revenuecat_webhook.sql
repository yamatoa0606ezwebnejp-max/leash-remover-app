-- Incremental migration for a project that already has the schema.sql from
-- 2026-08-17 applied (credits table + claim_free_credit + consume_credit +
-- the old client-callable add_credits). Run this in the Supabase Dashboard
-- SQL Editor to bring it up to date with the current schema.sql.
--
-- What this does: removes the client-trusted add_credits(amount) RPC and
-- replaces it with add_credits_for_user(), callable only by the
-- service_role — i.e. only from the revenuecat-webhook Edge Function, once
-- RevenueCat has actually confirmed a purchase. See supabase/schema.sql for
-- the full up-to-date reference and supabase/functions/revenuecat-webhook
-- for the function that calls this.

drop function if exists public.add_credits(integer);

create table public.processed_webhook_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.processed_webhook_events enable row level security;
-- No policies granted to anon/authenticated — this table is only ever
-- touched by the Edge Function via the service_role key, which bypasses RLS.

create or replace function public.add_credits_for_user(
  p_user_id uuid,
  p_amount integer,
  p_event_id text
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_balance integer;
begin
  insert into public.processed_webhook_events (event_id) values (p_event_id)
  on conflict (event_id) do nothing;

  if not found then
    select balance into new_balance from public.credits where user_id = p_user_id;
    return coalesce(new_balance, 0);
  end if;

  insert into public.credits (user_id, balance) values (p_user_id, p_amount)
  on conflict (user_id) do update set balance = credits.balance + p_amount, updated_at = now()
  returning balance into new_balance;
  return new_balance;
end;
$$;

-- Deliberately NOT granted to anon/authenticated — only the service_role
-- (used exclusively by the revenuecat-webhook Edge Function) can call this.
revoke all on function public.add_credits_for_user(uuid, integer, text) from public;
grant execute on function public.add_credits_for_user(uuid, integer, text) to service_role;
