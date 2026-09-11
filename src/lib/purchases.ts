import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

// Product IDs must match what's configured in App Store Connect + attached
// to a RevenueCat Offering. Credit amounts are enforced server-side by the
// revenuecat-webhook Edge Function (see supabase/functions/revenuecat-webhook)
// — this map is display-only, so the purchase screen can show "what you get"
// before the user buys.
export const CREDIT_PACK_PRODUCT_IDS = {
  'com.yamatohoriguchi.leashoff.credits.3': 3,
  'com.yamatohoriguchi.leashoff.credits.10': 10,
  'com.yamatohoriguchi.leashoff.credits.20': 20,
} as const;

// Three tiers (free / standard / premium), decided 2026-09-11 — see project
// memory project_leashoff_billing_v2_redesign. Standard's perk set is warm
// + a monthly credit allowance; premium gets the same plus whatever
// premium-exclusive features get designed later (not decided yet — nothing
// to build for those beyond having `tier` available to gate on). Neither
// product exists in App Store Connect / a RevenueCat offering yet, so these
// IDs are placeholders following the existing consumables' naming
// convention (kept in sync manually with
// supabase/functions/revenuecat-webhook/index.ts, same pattern as the
// consumables above). Harmless until the real products exist: Purchases
// .getOfferings() simply won't return a package with either identifier
// before then, so nothing below ever matches one.
export const SUBSCRIPTION_TIER_BY_PRODUCT_ID = {
  'com.yamatohoriguchi.leashoff.standard.monthly': 'standard',
  'com.yamatohoriguchi.leashoff.premium.monthly': 'premium',
} as const;

export type SubscriptionTier = 'free' | 'standard' | 'premium';

// Display order for the purchase screen — standard first (the "step up from
// free" option), premium last (the top tier).
export const SUBSCRIPTION_PRODUCT_IDS_IN_TIER_ORDER = [
  'com.yamatohoriguchi.leashoff.standard.monthly',
  'com.yamatohoriguchi.leashoff.premium.monthly',
] as const;

let configured = false;

export function configurePurchases() {
  if (configured || Platform.OS !== 'ios') return;
  if (!apiKey) {
    console.warn(
      'Missing EXPO_PUBLIC_REVENUECAT_API_KEY — purchases are disabled. Create a RevenueCat project and add the key to .env.',
    );
    return;
  }
  Purchases.configure({ apiKey });
  configured = true;
}

export function isPurchasesConfigured() {
  return configured;
}

export { Purchases };
