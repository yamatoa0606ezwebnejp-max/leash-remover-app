import { Linking, Platform } from 'react-native';
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

// Makes sure RevenueCat's app_user_id is this Supabase user id, retrying
// logIn if it isn't, and reports whether it ended up matching. A purchase
// made under any other id (typically $RCAnonymousID:..., left over when an
// earlier logIn failed on a flaky network) can never be credited by
// revenuecat-webhook — see issue #6 — so the purchase screen calls this
// right before purchasePackage() and refuses to buy on false.
export async function ensurePurchasesIdentity(userId: string) {
  if (!configured) return false;
  try {
    if ((await Purchases.getAppUserID()) === userId) return true;
    await Purchases.logIn(userId);
    return (await Purchases.getAppUserID()) === userId;
  } catch (error) {
    console.warn('ensurePurchasesIdentity failed', error);
    return false;
  }
}

// Cancelling/downgrading a subscription is a StoreKit action, not a
// Supabase one — this app has no way to do it itself, only to open Apple's
// own management screen. Shared by Settings and the purchase screen's Free
// row so the URL and failure handling can't drift between the two.
const SUBSCRIPTION_MANAGEMENT_URL = 'https://apps.apple.com/account/subscriptions';

export async function openSubscriptionManagement() {
  try {
    await Linking.openURL(SUBSCRIPTION_MANAGEMENT_URL);
    return true;
  } catch (error) {
    console.warn('openSubscriptionManagement failed', error);
    return false;
  }
}

// This app's access (credits, subscription tier) lives server-side against
// the Supabase account, not the local RevenueCat/StoreKit receipt cache, so
// re-signing in with the same Apple ID already restores everything on its
// own — this is a belt-and-suspenders sync of RevenueCat's local state for
// App Review's benefit (Guideline 3.1.1 expects a restore path on apps with
// subscriptions), not the primary recovery mechanism.
export async function restorePurchases() {
  try {
    await Purchases.restorePurchases();
    return true;
  } catch (error) {
    console.warn('restorePurchases failed', error);
    return false;
  }
}

// Required in-app on the purchase screen itself for apps offering
// auto-renewable subscriptions (Guideline 3.1.2(c)) — a link in the App
// Store description/metadata alone isn't enough. Same URLs already used in
// the App Store Connect Privacy Policy field and the app description's EULA
// line, kept here so the purchase screen can't drift from those.
export const PRIVACY_POLICY_URL =
  'https://claude.ai/code/artifact/afdd9332-3fd0-4137-b296-059983d49ce4#privacy';
export const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export async function openLegalLink(url: string) {
  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    console.warn('openLegalLink failed', error);
    return false;
  }
}

export { Purchases };
