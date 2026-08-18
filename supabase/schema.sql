-- LeashOff: credit balance + free-credit dedup, tied to the authenticated
-- Apple identity (Supabase Auth session created via signInWithIdToken).
--
-- Run this once in the Supabase Dashboard SQL Editor after enabling the
-- Apple auth provider (Authentication > Providers > Apple, with this app's
-- bundle id, com.yamatohoriguchi.leashoff, added under Client IDs).
--
-- Balance mutations only happen through the SECURITY DEFINER functions
-- below (claim_free_credit / consume_credit / add_credits_for_user) — there
-- is no insert/update RLS policy on the table itself, so a client can never
-- write an arbitrary balance directly. add_credits_for_user (purchased
-- credits) is only callable by the service_role, i.e. only from the
-- revenuecat-webhook Edge Function — see the "part 2" section below.

create table public.credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0,
  free_credit_claimed boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.credits enable row level security;

create policy "select own credits" on public.credits
  for select using (auth.uid() = user_id);

grant select on public.credits to authenticated;

create or replace function public.claim_free_credit()
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_balance integer;
begin
  insert into public.credits (user_id, balance, free_credit_claimed)
  values (auth.uid(), 1, true)
  on conflict (user_id) do update
    set balance = credits.balance + 1, free_credit_claimed = true, updated_at = now()
    where credits.free_credit_claimed = false
  returning balance into new_balance;

  if new_balance is null then
    select balance into new_balance from public.credits where user_id = auth.uid();
  end if;
  return new_balance;
end;
$$;

create or replace function public.consume_credit()
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_balance integer;
begin
  update public.credits set balance = balance - 1, updated_at = now()
    where user_id = auth.uid() and balance > 0
  returning balance into new_balance;
  return new_balance; -- null means insufficient balance
end;
$$;

grant execute on function public.claim_free_credit() to authenticated;
grant execute on function public.consume_credit() to authenticated;

-- Purchased credits, part 2: verified via RevenueCat webhook -----------------
--
-- add_credits(amount) used to be callable directly by the signed-in client
-- and trusted whatever amount it sent — that's gone. Credits from a real
-- purchase are now granted only by the revenuecat-webhook Edge Function,
-- running as the `service_role` (which authenticates as the *user who made
-- the purchase* is not available — the webhook knows the user only via
-- RevenueCat's app_user_id, which the client sets to its Supabase user id at
-- sign-in via Purchases.logIn(), see src/state/flow-context.tsx).
--
-- processed_webhook_events makes crediting idempotent: RevenueCat retries
-- webhook delivery until it gets a 200, so the same purchase event can be
-- delivered more than once.

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
