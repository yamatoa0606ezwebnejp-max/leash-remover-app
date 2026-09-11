// RevenueCat webhook receiver — the only thing allowed to grant purchased
// credits (see supabase/migrations/002_revenuecat_webhook.sql). The client
// app can never credit itself directly.
//
// Setup (see the RevenueCat + Supabase setup checklist for the full steps):
//   1. supabase functions deploy revenuecat-webhook --no-verify-jwt
//   2. supabase secrets set REVENUECAT_WEBHOOK_SECRET=<a random string you invent>
//   3. RevenueCat dashboard > Project Settings > Integrations > Webhooks:
//      URL = https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
//      Authorization header value = the same secret from step 2
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Supabase
// Edge Runtime — no need to set them manually.

import { createClient } from 'npm:@supabase/supabase-js@2';

// Product IDs must match what's configured in App Store Connect + attached
// to a RevenueCat Offering, and mirror src/lib/purchases.ts on the client
// (kept in sync manually — client and server can't share a module here).
const CREDIT_AMOUNTS_BY_PRODUCT_ID: Record<string, number> = {
  'com.yamatohoriguchi.leashoff.credits.3': 3,
  'com.yamatohoriguchi.leashoff.credits.10': 10,
  'com.yamatohoriguchi.leashoff.credits.20': 20,
};

// Event types RevenueCat sends for a one-time (non-subscription) purchase.
// See https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
const CREDITABLE_EVENT_TYPES = new Set(['NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE']);

// Two subscription tiers (decided 2026-09-11, see project memory
// project_leashoff_billing_v2_redesign) — standard's perk set is warm +
// this monthly allowance; premium gets the same plus whatever
// premium-exclusive features get designed later (not this webhook's
// concern — it only ever grants credits, gating any extra premium feature
// happens client-side off public.subscriptions.revenuecat_product_id).
// Neither product exists in App Store Connect / a RevenueCat offering yet —
// these are placeholders following the consumables' naming convention;
// update the moment the real products exist. Until then no real event can
// ever carry either product_id, so everything below stays inert.
//
// PLACEHOLDER amounts — both still undecided, blocked on real Cloud Run
// cost data from Daisuke. Swappable without any other code or schema
// change: grant_subscription_credits (008_subscription_credit_ledger.sql)
// takes the amount as a parameter, so updating these numbers and
// redeploying is the entire change needed once the real numbers are known.
const MONTHLY_CREDIT_ALLOWANCE_BY_PRODUCT_ID: Record<string, number> = {
  'com.yamatohoriguchi.leashoff.standard.monthly': 5,
  'com.yamatohoriguchi.leashoff.premium.monthly': 10,
};

const SUBSCRIPTION_PRODUCT_IDS = new Set(Object.keys(MONTHLY_CREDIT_ALLOWANCE_BY_PRODUCT_ID));

// Which lifecycle events reset the subscription credit pool, and to what
// amount for a given product. INITIAL_PURCHASE/RENEWAL/UNCANCELLATION grant
// a fresh period's allowance for whichever tier's product_id the event
// carries (reset, not added — see grant_subscription_credits). EXPIRATION
// zeroes the pool regardless of tier: access is actually gone at that
// point, unlike CANCELLATION (which only turns off auto-renew — the
// subscriber keeps their current period's credits and access until
// current_period_end, per SUBSCRIPTION_STATUS_BY_EVENT_TYPE's own comment
// on that distinction), so CANCELLATION deliberately has no entry here and
// grants/zeroes nothing.
function subscriptionCreditGrantAmount(eventType: string, productId: string): number | undefined {
  if (eventType === 'EXPIRATION') return 0;
  if (
    eventType === 'INITIAL_PURCHASE' ||
    eventType === 'RENEWAL' ||
    eventType === 'UNCANCELLATION' ||
    // A tier switch (standard <-> premium) resets the pool to the *new*
    // tier's allowance immediately, same as a fresh period — this is what
    // keeps "subscription_balance is always this period's allowance for the
    // plan currently in effect" true as an invariant, rather than adding a
    // separate up/downgrade-proration rule. See the caller for how
    // productId is derived for this event type specifically (it's not
    // event.product_id, which is the *old* plan for PRODUCT_CHANGE).
    eventType === 'PRODUCT_CHANGE'
  ) {
    return MONTHLY_CREDIT_ALLOWANCE_BY_PRODUCT_ID[productId];
  }
  return undefined;
}

// Which status each subscription-lifecycle event type maps to. Deliberately
// literal (event name -> matching status name) rather than tracking true
// entitlement access: CANCELLATION means "auto-renew turned off", not
// "access revoked" — RevenueCat's own docs are explicit that a cancelled
// subscriber keeps access until current_period_end, even though status
// flips to 'cancelled' here. Whatever eventually gates a premium feature off
// this table should compare current_period_end to now() if that distinction
// matters to it, not just read status — moot today since nothing reads this
// table for gating yet. BILLING_ISSUE and anything else RevenueCat sends
// are deliberately absent here and fall through to "Ignored", same as an
// event type this webhook has never acted on. PRODUCT_CHANGE is a tier
// switch (standard <-> premium) — status stays 'active' either way, so it
// maps the same as the other active-ing events; see handleSubscriptionEvent
// for how the *product* gets updated for this one specifically.
const SUBSCRIPTION_STATUS_BY_EVENT_TYPE: Record<string, 'active' | 'cancelled' | 'expired'> = {
  INITIAL_PURCHASE: 'active',
  RENEWAL: 'active',
  UNCANCELLATION: 'active',
  PRODUCT_CHANGE: 'active',
  CANCELLATION: 'cancelled',
  EXPIRATION: 'expired',
};

const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!webhookSecret || req.headers.get('Authorization') !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { event?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = body.event;
  if (!event) return new Response('Missing event', { status: 400 });

  const eventType = event.type as string | undefined;
  const productId = event.product_id as string | undefined;
  if (!eventType) return new Response('Ignored', { status: 200 });

  // Routed by product_id, not event type: INITIAL_PURCHASE fires for both a
  // consumable and a subscription, and only the product tells them apart.
  if (productId && SUBSCRIPTION_PRODUCT_IDS.has(productId)) {
    return await handleSubscriptionEvent(eventType, event);
  }
  return await handleConsumableEvent(eventType, event);
});

// A one-time credits pack (see credits.3/10/20 above). Unaffected by the
// subscription-lifecycle work: same function, same behavior as before.
async function handleConsumableEvent(eventType: string, event: Record<string, unknown>): Promise<Response> {
  // Not a purchase we grant credits for (e.g. CANCELLATION, BILLING_ISSUE,
  // TEST). Acknowledge with 200 so RevenueCat doesn't retry.
  if (!CREDITABLE_EVENT_TYPES.has(eventType)) {
    return new Response('Ignored', { status: 200 });
  }

  const eventId = event.id as string | undefined;
  const appUserId = event.app_user_id as string | undefined;
  const productId = event.product_id as string | undefined;
  if (!eventId || !appUserId || !productId) {
    console.error('Creditable event missing required fields', event);
    return new Response('Malformed event', { status: 400 });
  }

  const amount = CREDIT_AMOUNTS_BY_PRODUCT_ID[productId];
  if (!amount) {
    console.error(`Unknown product_id ${productId}, ignoring`);
    return new Response('Unknown product', { status: 200 });
  }

  const { error } = await supabase.rpc('add_credits_for_user', {
    p_user_id: appUserId,
    p_amount: amount,
    p_event_id: eventId,
  });

  if (error) {
    console.error('add_credits_for_user failed', error);
    return new Response('Server error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

// Either paid tier's lifecycle: status, and (since
// 008_subscription_credit_ledger.sql) the subscription credit pool. Exact
// monthly allowances are still placeholders (see
// MONTHLY_CREDIT_ALLOWANCE_BY_PRODUCT_ID above) — swap those numbers once
// real cost data is in, no other change needed here.
//
// Known gap, acceptable for now: set_subscription_status always applies
// whatever this call sends, with no check that the event it came from is
// newer than whatever was last written. RevenueCat's own docs don't
// guarantee webhook delivery order, so a delayed/retried older event could
// in principle overwrite a newer status. Not fixed here — it would mean
// storing and comparing event_timestamp_ms, a real schema change, for a
// product that doesn't exist yet and therefore has no real traffic to
// reorder. Revisit if this ever needs to be trustworthy under retries.
async function handleSubscriptionEvent(eventType: string, event: Record<string, unknown>): Promise<Response> {
  const status = SUBSCRIPTION_STATUS_BY_EVENT_TYPE[eventType];
  if (!status) {
    return new Response('Ignored', { status: 200 });
  }

  const appUserId = event.app_user_id as string | undefined;
  if (!appUserId) {
    console.error('Subscription event missing app_user_id', event);
    return new Response('Malformed event', { status: 400 });
  }

  // The product the subscriber is on *after* this event. For every event
  // type except PRODUCT_CHANGE this is just event.product_id — but
  // PRODUCT_CHANGE (a standard <-> premium tier switch) carries the *old*
  // plan in product_id and the plan just switched to in new_product_id (per
  // RevenueCat's webhook field docs), so reading product_id alone here would
  // silently record the tier the subscriber just left. Computed once and
  // reused for both the status write and the credit grant below, rather
  // than re-deriving (and risking this exact mistake) in each place.
  const effectiveProductId =
    (event.new_product_id as string | undefined) ?? (event.product_id as string | undefined);

  // Milliseconds since epoch, per RevenueCat's webhook payload. Not every
  // event type is guaranteed to carry it — stored as null rather than
  // guessed when absent. Checked by type, not truthiness: 0 is a valid (if
  // absurd) timestamp and shouldn't be treated the same as missing.
  const expirationMs = event.expiration_at_ms;
  const periodEnd = typeof expirationMs === 'number' ? new Date(expirationMs).toISOString() : null;

  const { error } = await supabase.rpc('set_subscription_status', {
    p_user_id: appUserId,
    p_status: status,
    p_product_id: effectiveProductId ?? null,
    p_period_end: periodEnd,
  });

  if (error) {
    console.error('set_subscription_status failed', error);
    return new Response('Server error', { status: 500 });
  }

  // Not every status-changing event also changes the credit pool (see
  // subscriptionCreditGrantAmount's comment above — CANCELLATION notably
  // doesn't touch it, and returns undefined here). `!== undefined` rather
  // than a truthy check: 0 (EXPIRATION's amount) is a real, intentional
  // grant, not "absent".
  const grantAmount = subscriptionCreditGrantAmount(eventType, effectiveProductId ?? '');
  if (grantAmount !== undefined) {
    const eventId = event.id as string | undefined;
    if (!eventId) {
      console.error('Subscription credit event missing id', event);
      return new Response('Malformed event', { status: 400 });
    }
    const { error: creditError } = await supabase.rpc('grant_subscription_credits', {
      p_user_id: appUserId,
      p_amount: grantAmount,
      p_event_id: eventId,
    });
    if (creditError) {
      console.error('grant_subscription_credits failed', creditError);
      return new Response('Server error', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}
