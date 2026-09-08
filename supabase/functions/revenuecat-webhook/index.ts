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

// Not yet created in App Store Connect / attached to a RevenueCat offering —
// see project memory project_leashoff_billing_v2_redesign. A placeholder
// following the naming convention of the consumables above; update this the
// moment the real product exists. Until then no real event can ever carry
// this product_id, so everything below stays inert.
const PREMIUM_SUBSCRIPTION_PRODUCT_ID = 'com.yamatohoriguchi.leashoff.premium.monthly';

// Which status each subscription-lifecycle event type maps to. Deliberately
// literal (event name -> matching status name) rather than tracking true
// entitlement access: CANCELLATION means "auto-renew turned off", not
// "access revoked" — RevenueCat's own docs are explicit that a cancelled
// subscriber keeps access until current_period_end, even though status
// flips to 'cancelled' here. Whatever eventually gates a premium feature off
// this table should compare current_period_end to now() if that distinction
// matters to it, not just read status — moot today since nothing reads this
// table for gating yet. BILLING_ISSUE, PRODUCT_CHANGE and anything else
// RevenueCat sends are deliberately absent here and fall through to
// "Ignored", same as an event type this webhook has never acted on.
const SUBSCRIPTION_STATUS_BY_EVENT_TYPE: Record<string, 'active' | 'cancelled' | 'expired'> = {
  INITIAL_PURCHASE: 'active',
  RENEWAL: 'active',
  UNCANCELLATION: 'active',
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
  if (productId === PREMIUM_SUBSCRIPTION_PRODUCT_ID) {
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

// The premium subscription's lifecycle. Status only, deliberately — no
// credits are granted here yet. See project memory
// project_leashoff_billing_v2_redesign: the monthly allowance is still
// unset (blocked on real cost data) and reset-not-rollover needs a ledger
// design (tracking subscription-granted credits separately from purchased
// ones) that hasn't been built. Wiring status now, without that, means the
// app can already tell "is this user premium" once it's ready to ask —
// nothing reads this table for that yet either.
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

  // Milliseconds since epoch, per RevenueCat's webhook payload. Not every
  // event type is guaranteed to carry it — stored as null rather than
  // guessed when absent. Checked by type, not truthiness: 0 is a valid (if
  // absurd) timestamp and shouldn't be treated the same as missing.
  const expirationMs = event.expiration_at_ms;
  const periodEnd = typeof expirationMs === 'number' ? new Date(expirationMs).toISOString() : null;

  const { error } = await supabase.rpc('set_subscription_status', {
    p_user_id: appUserId,
    p_status: status,
    p_product_id: (event.product_id as string | undefined) ?? null,
    p_period_end: periodEnd,
  });

  if (error) {
    console.error('set_subscription_status failed', error);
    return new Response('Server error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
