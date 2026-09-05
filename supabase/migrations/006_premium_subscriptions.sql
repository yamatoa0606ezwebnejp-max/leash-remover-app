-- Billing model v2, schema half: 5 free trial credits (was 1) + a table to
-- track premium subscription status. See project memory
-- project_leashoff_billing_v2_redesign for the full design discussion this
-- implements part of.
--
-- Deliberately NOT included here (out of scope for this migration):
-- - The exact monthly premium credit allowance is still undecided (pending
--   real Cloud Run cost data) — granting those credits will reuse the
--   existing add_credits_for_user(user_id, amount, event_id) from
--   002_revenuecat_webhook.sql once that number is known and the webhook is
--   wired to call it on a subscription RENEWAL event. No new
--   credit-granting function is needed for that.
-- - revenuecat-webhook's subscription-lifecycle handling
--   (INITIAL_PURCHASE/RENEWAL/CANCELLATION/EXPIRATION for the new
--   auto-renewing product) is not implemented yet — this migration only adds
--   the table + function it will call once it exists.
-- - Charging a credit on runRemoval() (export=standard) is a
--   leash-remover-api contract change, not a Supabase schema change.
--
-- Run in the Supabase Dashboard SQL Editor after 005_free_credit_abuse_prevention.sql.

-- 1. Free trial credits: 1 -> 5 -----------------------------------------------------
--
-- Same function as 005, only the granted amount changes. Keeping the same
-- apple_sub-keyed dedup (claimed_free_credits) — this only changes how much
-- a first-time claim grants, not the anti-abuse logic itself.

create or replace function public.claim_free_credit()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  new_balance integer;
  v_apple_sub text;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous users cannot claim the free credit';
  end if;

  select provider_id into v_apple_sub
    from auth.identities
   where user_id = auth.uid() and provider = 'apple'
   limit 1;

  if v_apple_sub is not null then
    insert into public.claimed_free_credits (apple_sub) values (v_apple_sub)
    on conflict (apple_sub) do nothing;

    if not found then
      select balance into new_balance from public.credits where user_id = auth.uid();
      return coalesce(new_balance, 0);
    end if;
  end if;

  insert into public.credits (user_id, balance, free_credit_claimed)
  values (auth.uid(), 5, true)
  on conflict (user_id) do update
    set balance = credits.balance + 5, free_credit_claimed = true, updated_at = now()
    where credits.free_credit_claimed = false
  returning balance into new_balance;

  if new_balance is null then
    select balance into new_balance from public.credits where user_id = auth.uid();
  end if;
  return new_balance;
end;
$$;

revoke all on function public.claim_free_credit() from public;
grant execute on function public.claim_free_credit() to authenticated;

-- 2. Premium subscription status ----------------------------------------------------
--
-- Tracks whether a user currently has an active premium subscription, kept
-- up to date by the revenuecat-webhook Edge Function (service_role) on each
-- subscription lifecycle event. Separate from credits.balance: this is
-- status/metadata, not a spendable amount.

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'none' check (status in ('none', 'active', 'expired', 'cancelled')),
  revenuecat_product_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "select own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

grant select on public.subscriptions to authenticated;

create or replace function public.set_subscription_status(
  p_user_id uuid,
  p_status text,
  p_product_id text,
  p_period_end timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, status, revenuecat_product_id, current_period_end)
  values (p_user_id, p_status, p_product_id, p_period_end)
  on conflict (user_id) do update
    set status = p_status,
        revenuecat_product_id = p_product_id,
        current_period_end = p_period_end,
        updated_at = now();
end;
$$;

-- Deliberately NOT granted to anon/authenticated — only the service_role
-- (used exclusively by the revenuecat-webhook Edge Function, same as
-- add_credits_for_user in 002_revenuecat_webhook.sql) can call this.
revoke all on function public.set_subscription_status(uuid, text, text, timestamptz) from public;
grant execute on function public.set_subscription_status(uuid, text, text, timestamptz) to service_role;
