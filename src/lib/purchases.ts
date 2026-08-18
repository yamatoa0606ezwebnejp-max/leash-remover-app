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
