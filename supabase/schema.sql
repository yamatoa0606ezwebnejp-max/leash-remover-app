-- LeashOff: credit balance + free-credit dedup, tied to the authenticated
-- Apple identity (Supabase Auth session created via signInWithIdToken).
--
-- Run this once in the Supabase Dashboard SQL Editor after enabling the
-- Apple auth provider (Authentication > Providers > Apple, with this app's
-- bundle id, com.yamatohoriguchi.leashoff, added under Client IDs).
--
-- Balance mutations only happen through the SECURITY DEFINER functions
-- below (claim_free_credit / consume_credit / add_credits) — there is no
-- insert/update RLS policy on the table itself, so a client can never
-- write an arbitrary balance directly.

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

create or replace function public.add_credits(amount integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_balance integer;
begin
  insert into public.credits (user_id, balance) values (auth.uid(), amount)
  on conflict (user_id) do update set balance = credits.balance + amount, updated_at = now()
  returning balance into new_balance;
  return new_balance;
end;
$$;

grant execute on function public.claim_free_credit() to authenticated;
grant execute on function public.consume_credit() to authenticated;
grant execute on function public.add_credits(integer) to authenticated;
