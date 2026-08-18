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
  const eventId = event.id as string | undefined;
  const appUserId = event.app_user_id as string | undefined;
  const productId = event.product_id as string | undefined;

  // Not a purchase we grant credits for (e.g. CANCELLATION, BILLING_ISSUE,
  // TEST). Acknowledge with 200 so RevenueCat doesn't retry.
  if (!eventType || !CREDITABLE_EVENT_TYPES.has(eventType)) {
    return new Response('Ignored', { status: 200 });
  }

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
});
