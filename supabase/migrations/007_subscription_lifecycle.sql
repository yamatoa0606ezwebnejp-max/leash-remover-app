-- Fix the account-deletion/subscription interaction flagged when 006 shipped,
-- and nothing else — this migration does NOT add subscription credit
-- granting (still blocked on Daisuke's real cost data and a reset-not-
-- rollover ledger design; see project memory
-- project_leashoff_billing_v2_redesign). It exists so the webhook change in
-- this same commit (revenuecat-webhook's subscription-lifecycle handling)
-- has somewhere safe to write.
--
-- Run in the Supabase Dashboard SQL Editor after 006_premium_subscriptions.sql.

-- Problem: subscriptions.user_id references auth.users(id) on delete cascade
-- (006). Apple's subscription billing doesn't stop when the Supabase account
-- is deleted (self-service deletion exists for Guideline 5.1.1(v), see
-- supabase/functions/delete-account) — it's a real ongoing charge on Apple's
-- side, independent of whether our row survives. Today, deleting the account
-- silently drops that row, and the next RENEWAL webhook for that (now
-- nonexistent) user_id would hit an insert against a foreign key with
-- nothing to reference.
--
-- Unlike claimed_free_credits (005), this isn't a fraud-prevention problem —
-- there's no benefit to a user from losing this row, nothing to farm by
-- deleting it — so it doesn't need claimed_free_credits' apple_sub-keyed
-- redesign. It just needs to stop being deleted out from under a still-live
-- Apple subscription. Dropping the FK (rather than changing its ON DELETE
-- behavior) is the fix: ON DELETE CASCADE loses the row (today's bug); the
-- only other options are the default RESTRICT (blocks account deletion
-- entirely for anyone who ever subscribed — not acceptable, deletion has to
-- always work) or SET NULL (invalid on a primary key column). A plain column
-- with no FK still enforces nothing on write, but this function is
-- service_role-only, fed only by RevenueCat's own app_user_id — the same
-- trust boundary add_credits_for_user already relies on.
--
-- Found by name rather than a bare `drop constraint if exists
-- subscriptions_user_id_fkey`: Postgres's default naming (<table>_<column>_
-- fkey) is very likely what 006 got, but "very likely" guessed wrong would
-- make this whole migration a silent no-op — `if exists` swallows a name
-- mismatch with no error, which is worse than not running this file at all.
-- Looking the name up from pg_constraint instead means this either fixes
-- the real constraint or raises, never quietly does neither.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.subscriptions'::regclass
    and contype = 'f'
    and conkey = array[
      (select attnum from pg_attribute
        where attrelid = 'public.subscriptions'::regclass and attname = 'user_id')
    ];

  if v_constraint_name is null then
    raise exception 'no foreign key found on public.subscriptions.user_id — has this already been fixed, or did 006 not apply as expected?';
  end if;

  execute format('alter table public.subscriptions drop constraint %I', v_constraint_name);
end $$;

-- The "select own subscription" RLS policy from 006 is unaffected: it only
-- ever matches while auth.uid() = user_id can be true, i.e. while the
-- account exists. No RLS change needed here.
