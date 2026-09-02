-- Close the free-credit farming loop that account deletion opened.
--
-- 003 made claim_free_credit() require a real Apple identity specifically so
-- that "delete the account (or reinstall) and get a new free credit" isn't
-- possible — the uid is per-account, but the same Apple ID always maps back
-- to the same account via linkIdentity()'s identity_already_exists check.
--
-- Self-service account deletion (supabase/functions/delete-account) broke
-- that: auth.identities.user_id references auth.users(id) on delete cascade,
-- so deleting the account also deletes the Apple identity link, freeing that
-- same Apple ID to linkIdentity() onto a brand new anonymous session and
-- claim another free credit. Delete + sign back in, repeated, farms free
-- credits (and the real GPU render time each one buys) indefinitely.
--
-- The fix: key the free-credit dedup on the Apple identity itself
-- (auth.identities.provider_id, i.e. Apple's `sub` claim), not on the
-- deletable Supabase user row. This table has no FK to auth.users on
-- purpose — it must survive the account it was claimed under being deleted.
--
-- Run in the Supabase Dashboard SQL Editor after 004_print_render_allowed.sql.

create table public.claimed_free_credits (
  apple_sub text primary key,
  claimed_at timestamptz not null default now()
);

alter table public.claimed_free_credits enable row level security;
-- No policies — only touched by claim_free_credit() below, which is
-- SECURITY DEFINER and so bypasses RLS.

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

  -- No Apple identity found is unexpected for a non-anonymous user today
  -- (Apple is the only sign-in provider), but fail safe rather than block
  -- the whole sign-in flow if that ever changes: fall back to the old
  -- per-account dedup below instead of raising.
  if v_apple_sub is not null then
    insert into public.claimed_free_credits (apple_sub) values (v_apple_sub)
    on conflict (apple_sub) do nothing;

    if not found then
      -- This Apple ID already claimed a free credit under some account,
      -- possibly one that no longer exists. Report the current balance
      -- (0 for a fresh account) without granting another.
      select balance into new_balance from public.credits where user_id = auth.uid();
      return coalesce(new_balance, 0);
    end if;
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
