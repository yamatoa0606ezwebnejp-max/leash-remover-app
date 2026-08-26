-- Move the print-credit check from the client to the server.
--
-- Until now the balance check was an `if` in export.tsx and the rendering service had
-- no idea what a credit was, so the check was advisory. These functions let that
-- service ask and charge directly, keyed on the user id in the Supabase access token
-- it now receives.
--
-- Run in the Supabase Dashboard SQL Editor, after 002_revenuecat_webhook.sql. Every
-- statement here is additive: nothing an existing client calls changes behaviour.

-- 1. The rendering service's role ---------------------------------------------------
--
-- Deliberately not service_role. That key bypasses row-level security on every table,
-- so a compromise of the rendering container would become a compromise of the whole
-- database. This role can execute three functions and do nothing else.

create role leash_api nologin;
grant usage on schema public to leash_api;

-- PostgREST reaches a role by SET ROLE from `authenticator`. Without this grant every
-- call arrives as a 500 rather than a permission error, which is a confusing hour.
grant leash_api to authenticator;

-- 2. Charging a print credit --------------------------------------------------------

-- The idempotency ledger, in the same shape as processed_webhook_events and for the
-- same reason: a response that never arrives gets retried, and the retry must not be a
-- second charge. Without this, a dropped connection at the wrong moment takes a credit
-- and hands back nothing.
create table public.consumed_render_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.consumed_render_requests enable row level security;
-- No policies. The function below is SECURITY DEFINER, so it does not go through RLS,
-- and nothing else has any business here.

create or replace function public.consume_print_credit(p_user_id uuid, p_request_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_balance integer;
begin
  insert into public.consumed_render_requests (request_id, user_id)
  values (p_request_id, p_user_id)
  on conflict (request_id) do nothing;

  if not found then
    -- Already charged. Report the balance, do not take another.
    return coalesce((select balance from public.credits where user_id = p_user_id), 0);
  end if;

  update public.credits set balance = balance - 1, updated_at = now()
    where user_id = p_user_id and balance > 0
  returning balance into new_balance;

  if new_balance is null then
    -- Nothing to spend. Release the ledger row so a later attempt, once they have
    -- bought more, is not mistaken for a duplicate of this one.
    delete from public.consumed_render_requests where request_id = p_request_id;
  end if;

  return new_balance; -- null means insufficient balance
end;
$$;

create or replace function public.get_credit_balance(p_user_id uuid)
returns integer
language sql security definer set search_path = public
as $$
  select coalesce((select balance from public.credits where user_id = p_user_id), 0)
$$;

-- 3. A per-user allowance -----------------------------------------------------------
--
-- Only warm is limited for now. It is the route where one wasted call can cost more
-- instance time than a credit earns, and removal itself is specified as free and
-- repeatable, so a limit on rendering is a product decision rather than a fix.

create table public.api_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  created_at timestamptz not null default now()
);
create index api_usage_user_event_time on public.api_usage (user_id, event, created_at desc);

alter table public.api_usage enable row level security;
-- No policies, same reasoning as above.

-- Counting and recording in one statement. Split into two calls, two concurrent
-- requests both read "one under the limit" and both proceed.
create or replace function public.check_and_record_usage(
  p_user_id uuid, p_event text, p_window_seconds integer, p_limit integer
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare used integer;
begin
  select count(*) into used from public.api_usage
   where user_id = p_user_id
     and event = p_event
     and created_at > now() - make_interval(secs => p_window_seconds);

  if used >= p_limit then
    return false;
  end if;

  insert into public.api_usage (user_id, event) values (p_user_id, p_event);
  return true;
end;
$$;

-- 4. Grants -------------------------------------------------------------------------
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so writing only
-- the `grant` below would leave these callable by `anon` as well. Revoke first, every
-- time.

revoke all on function public.consume_print_credit(uuid, uuid) from public;
revoke all on function public.get_credit_balance(uuid) from public;
revoke all on function public.check_and_record_usage(uuid, text, integer, integer) from public;

grant execute on function public.consume_print_credit(uuid, uuid) to leash_api;
grant execute on function public.get_credit_balance(uuid) to leash_api;
grant execute on function public.check_and_record_usage(uuid, text, integer, integer) to leash_api;

-- 5. The same omission, on the functions that already existed ------------------------
--
-- claim_free_credit and consume_credit were granted to `authenticated` without being
-- revoked from PUBLIC first, so `anon` can call them too. Nothing bad happens today
-- because both are scoped by auth.uid(), which is null for anon — but 002 revoked
-- add_credits_for_user and these were left, and an asymmetry like that reads as a
-- decision rather than an oversight. It also stops being harmless the moment either
-- function grows an argument.

revoke all on function public.claim_free_credit() from public;
revoke all on function public.consume_credit() from public;
grant execute on function public.claim_free_credit() to authenticated;
grant execute on function public.consume_credit() to authenticated;

-- 6. The free credit needs a real identity -------------------------------------------
--
-- Anonymous sign-in is being added so the free flow needs no account. An anonymous user
-- must not be able to claim the free credit: the uid is per-install, so deleting and
-- reinstalling would mint a new one every time. That is the known weakness of anonymous
-- auth, and requiring Apple here is what closes it.

create or replace function public.claim_free_credit()
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_balance integer;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous users cannot claim the free credit';
  end if;

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

revoke all on function public.claim_free_credit() from public;
grant execute on function public.claim_free_credit() to authenticated;
