-- Reset-not-rollover subscription credit ledger. See project memory
-- project_leashoff_billing_v2_redesign: 2026-09-08 decided monthly reset,
-- not accumulate — this migration is the schema/function work that decision
-- needed but never got. The monthly credit *amount* itself is still not
-- decided (blocked on real Cloud Run cost data) — this only builds the
-- mechanism; revenuecat-webhook supplies whatever number it's configured
-- with (a swappable placeholder), and changing that number later needs no
-- schema change.
--
-- Run in the Supabase Dashboard SQL Editor after 007_subscription_lifecycle.sql.

-- 1. A second credit pool ------------------------------------------------------------
--
-- Kept separate from credits.balance (purchased packs + the one-time free
-- trial grant) so a subscription period boundary can reset *only* this
-- portion. balance must never be touched by a subscription event — that's
-- what a user paid real money for (or the one-time free trial), and it has
-- to survive whether or not the subscription renews.
alter table public.credits
  add column subscription_balance integer not null default 0;

-- 2. Spend from the subscription pool first ------------------------------------------
--
-- Same function names/signatures leash-remover-api already calls (credits.py,
-- via the leash_api role) — only the SQL body changes here, so that side
-- needs no change. Subscription credits reset each period regardless of use,
-- so spending them first ("use it or lose it") wastes less value than
-- spending purchased/free balance first would.
create or replace function public.print_render_allowed(
  p_user_id uuid,
  p_request_id uuid
) returns boolean
language sql security definer set search_path = public
as $$
  select
    coalesce(
      (select balance + subscription_balance from public.credits where user_id = p_user_id),
      0
    ) > 0
    or exists (
      select 1 from public.consumed_render_requests
       where request_id = p_request_id and user_id = p_user_id
    )
$$;

create or replace function public.consume_print_credit(p_user_id uuid, p_request_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  new_subscription_balance integer;
  new_balance integer;
begin
  insert into public.consumed_render_requests (request_id, user_id)
  values (p_request_id, p_user_id)
  on conflict (request_id) do nothing;

  if not found then
    -- Already charged. Report the total, do not take another.
    return coalesce(
      (select balance + subscription_balance from public.credits where user_id = p_user_id),
      0
    );
  end if;

  update public.credits set subscription_balance = subscription_balance - 1, updated_at = now()
    where user_id = p_user_id and subscription_balance > 0
  returning subscription_balance into new_subscription_balance;

  if new_subscription_balance is not null then
    select balance into new_balance from public.credits where user_id = p_user_id;
    return new_balance + new_subscription_balance;
  end if;

  -- No subscription credits to spend — fall back to purchased/free balance,
  -- unchanged from before this migration.
  update public.credits set balance = balance - 1, updated_at = now()
    where user_id = p_user_id and balance > 0
  returning balance into new_balance;

  if new_balance is null then
    -- Nothing to spend in either pool. Release the ledger row so a later
    -- attempt, once they have credits again, is not mistaken for a
    -- duplicate of this one.
    delete from public.consumed_render_requests where request_id = p_request_id;
    return null;
  end if;

  return new_balance; -- subscription_balance was already 0 here
end;
$$;

create or replace function public.get_credit_balance(p_user_id uuid)
returns integer
language sql security definer set search_path = public
as $$
  select coalesce(
    (select balance + subscription_balance from public.credits where user_id = p_user_id),
    0
  )
$$;

-- Grants on all three functions above are unchanged by create-or-replace
-- (signatures are identical to what 003/004 granted to leash_api).

-- 3. Granting/resetting subscription credits, called from revenuecat-webhook --------
--
-- SET semantics, not ADD: every call replaces subscription_balance outright,
-- which is what implements "reset, not rollover" — whatever was left unused
-- from the period that just ended is simply overwritten, never carried
-- forward, with no separate zero-out-then-grant step to keep in sync.
-- Idempotent on p_event_id via the same processed_webhook_events ledger
-- add_credits_for_user already uses (002_revenuecat_webhook.sql) —
-- RevenueCat event ids are unique across event types, so sharing that table
-- with consumable-purchase events is safe.
--
-- Also used to zero the pool on EXPIRATION (call with p_amount = 0) — one
-- function, not two, since both cases are just "set the pool to this value."
create or replace function public.grant_subscription_credits(
  p_user_id uuid,
  p_amount integer,
  p_event_id text
) returns integer
language plpgsql security definer set search_path = public
as $$
declare new_subscription_balance integer;
begin
  insert into public.processed_webhook_events (event_id) values (p_event_id)
  on conflict (event_id) do nothing;

  if not found then
    return coalesce((select subscription_balance from public.credits where user_id = p_user_id), 0);
  end if;

  insert into public.credits (user_id, subscription_balance) values (p_user_id, p_amount)
  on conflict (user_id) do update
    set subscription_balance = p_amount, updated_at = now()
  returning subscription_balance into new_subscription_balance;

  return new_subscription_balance;
end;
$$;

revoke all on function public.grant_subscription_credits(uuid, integer, text) from public;
grant execute on function public.grant_subscription_credits(uuid, integer, text) to service_role;
