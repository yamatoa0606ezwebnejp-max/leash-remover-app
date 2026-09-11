import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesError, PurchasesPackage } from 'react-native-purchases';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  CREDIT_PACK_PRODUCT_IDS,
  SUBSCRIPTION_PRODUCT_IDS_IN_TIER_ORDER,
  SUBSCRIPTION_TIER_BY_PRODUCT_ID,
  Purchases,
  isPurchasesConfigured,
} from '@/lib/purchases';
import { useFlow } from '@/state/flow-context';

// Purchased credits are granted server-side once RevenueCat's webhook fires
// (see supabase/functions/revenuecat-webhook), so after purchasePackage()
// resolves we don't know the new balance yet — poll refreshCredits() a few
// times with backoff instead of trusting a client-side amount. Only valid
// for a consumable pack, where "did the balance go up" is the only success
// signal available — see waitForSubscriptionSync below for why a
// subscription purchase can't use this same check.
async function waitForCreditIncrease(refreshCredits: () => Promise<number>, before: number) {
  const delaysMs = [500, 1000, 2000, 3000, 5000];
  for (const delay of delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const balance = await refreshCredits();
    if (balance > before) return true;
  }
  return false;
}

// A subscription purchase or tier switch is already confirmed the moment
// purchasePackage() resolves without throwing — StoreKit/RevenueCat's
// promise only resolves after the transaction actually completes. Unlike a
// consumable, there's no "the balance went up" signal to wait for: a
// downgrade (premium -> standard) legitimately *lowers* subscription_balance
// via grant_subscription_credits' reset-not-add semantics
// (008_subscription_credit_ledger.sql), so reusing waitForCreditIncrease
// here would report a successful downgrade as "hasn't updated yet" forever
// (found in a 2026-09-11 code-review pass, not yet hit live since only
// upgrades were tested that day). Just give the webhook a moment to land so
// the UI reflects the new tier/allowance, without gating success on which
// direction the number moved.
async function waitForSubscriptionSync(refreshCredits: () => Promise<number>) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await refreshCredits();
}

export default function PurchaseScreen() {
  const router = useRouter();
  const { credits, refreshCredits, subscriptionTier, isSignedIn } = useFlow();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(isPurchasesConfigured());
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [waitingForCredit, setWaitingForCredit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isPurchasesConfigured() ? null : 'Purchases are not configured yet.',
  );

  useEffect(() => {
    // Refreshes subscriptionTier (fire-and-forget inside refreshCredits, see
    // flow-context.tsx) so the "current plan" row below reflects a tier
    // change made just before this screen opened, rather than whatever was
    // last fetched at sign-in/app-launch — a code-review pass flagged that a
    // stale tier here could render the subscriber's own current plan as a
    // purchasable row instead of "current plan". Deliberately once-on-mount
    // ([] deps, not [refreshCredits]): that function's identity changes
    // whenever `credits` changes (see its own dependency array), so
    // depending on it here would re-run this on every credit change, not
    // just on opening the screen.
    refreshCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isPurchasesConfigured()) return;
    Purchases.getOfferings()
      .then((offerings) => {
        setPackages(offerings.current?.availablePackages ?? []);
      })
      .catch(() => setErrorMessage('Could not load credit packs. Try again later.'))
      .finally(() => setLoadingOfferings(false));
  }, []);

  const handlePurchase = useCallback(
    async (pkg: PurchasesPackage) => {
      // An anonymous purchase completes on Apple's side but can never be
      // credited: RevenueCat's app_user_id for an anonymous session is its
      // own alias string, not a Supabase uuid, so revenuecat-webhook's RPC
      // calls fail outright (uuid cast error) and retry forever with no
      // resolution — confirmed by hitting exactly this in a real sandbox
      // test (2026-09-11). Signing in later re-attributes the purchase to
      // the real account for RevenueCat's own records, but not for that
      // already-sent, already-failed webhook delivery. Block the purchase
      // itself, the same way correct.tsx/export.tsx already gate their
      // credit-charging actions on isSignedIn, rather than let it happen
      // and fail silently server-side.
      if (!isSignedIn) {
        router.push('/sign-in');
        return;
      }
      setErrorMessage(null);
      setPurchasingId(pkg.identifier);
      const creditsBefore = credits;
      const isSubscriptionPackage = pkg.product.identifier in SUBSCRIPTION_TIER_BY_PRODUCT_ID;
      try {
        await Purchases.purchasePackage(pkg);
        setPurchasingId(null);
        setWaitingForCredit(true);
        if (isSubscriptionPackage) {
          await waitForSubscriptionSync(refreshCredits);
          setWaitingForCredit(false);
          router.back();
        } else {
          const credited = await waitForCreditIncrease(refreshCredits, creditsBefore);
          setWaitingForCredit(false);
          if (credited) {
            router.back();
          } else {
            setErrorMessage(
              'Purchase completed, but your balance hasn’t updated yet. Pull back into this screen in a moment.',
            );
          }
        }
      } catch (error) {
        setPurchasingId(null);
        setWaitingForCredit(false);
        if ((error as Partial<PurchasesError>)?.userCancelled) return;
        setErrorMessage('Purchase failed. Please try again.');
      }
    },
    [credits, refreshCredits, router, isSignedIn],
  );

  // The two subscription tiers (once they exist — see
  // SUBSCRIPTION_TIER_BY_PRODUCT_ID) get their own section, in standard →
  // premium order, since they're recurring purchases with different framing
  // ("N credits every month" / already-subscribed status) than a one-time
  // top-up. Everything else falls back into the consumable list below, same
  // as before.
  const subscriptionPackagesInOrder = SUBSCRIPTION_PRODUCT_IDS_IN_TIER_ORDER.map((productId) =>
    packages.find((pkg) => pkg.product.identifier === productId),
  ).filter((pkg): pkg is PurchasesPackage => pkg !== undefined);
  const creditPackages = packages.filter(
    (pkg) => !(pkg.product.identifier in SUBSCRIPTION_TIER_BY_PRODUCT_ID),
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Buy Credits" onBack={() => router.back()} />

        <ThemedText themeColor="textSecondary">
          Removing a leash and print exports both use credits.{'\n'}Current balance: {credits}
        </ThemedText>

        {loadingOfferings && <ActivityIndicator />}
        {errorMessage && <ThemedText themeColor="textSecondary">{errorMessage}</ThemedText>}

        {subscriptionPackagesInOrder.length > 0 && (
          <View style={styles.list}>
            <ThemedText type="smallBold">Subscribe</ThemedText>
            {subscriptionPackagesInOrder.map((pkg) => {
              const tier =
                SUBSCRIPTION_TIER_BY_PRODUCT_ID[
                  pkg.product.identifier as keyof typeof SUBSCRIPTION_TIER_BY_PRODUCT_ID
                ];
              const isCurrentTier = subscriptionTier === tier;
              const isPurchasing = purchasingId === pkg.identifier;
              return isCurrentTier ? (
                <ThemedView key={pkg.identifier} type="backgroundElement" style={styles.rowInner}>
                  <ThemedText type="smallBold">
                    {pkg.product.title} — current plan
                  </ThemedText>
                </ThemedView>
              ) : (
                <Pressable
                  key={pkg.identifier}
                  disabled={isPurchasing || waitingForCredit}
                  onPress={() => handlePurchase(pkg)}
                  style={({ pressed }) => [
                    styles.row,
                    { opacity: pressed || isPurchasing || waitingForCredit ? 0.7 : 1 },
                  ]}>
                  <ThemedView type="backgroundElement" style={styles.rowInner}>
                    <View>
                      <ThemedText type="smallBold">{pkg.product.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Credits every month, auto-renews
                      </ThemedText>
                    </View>
                    {isPurchasing ? (
                      <ActivityIndicator />
                    ) : (
                      <ThemedText type="mono">{pkg.product.priceString}</ThemedText>
                    )}
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.list}>
          {creditPackages.map((pkg) => {
            const amount =
              CREDIT_PACK_PRODUCT_IDS[pkg.product.identifier as keyof typeof CREDIT_PACK_PRODUCT_IDS];
            const isPurchasing = purchasingId === pkg.identifier;
            return (
              <Pressable
                key={pkg.identifier}
                disabled={isPurchasing || waitingForCredit}
                onPress={() => handlePurchase(pkg)}
                style={({ pressed }) => [
                  styles.row,
                  { opacity: pressed || isPurchasing || waitingForCredit ? 0.7 : 1 },
                ]}>
                <ThemedView type="backgroundElement" style={styles.rowInner}>
                  <ThemedText type="smallBold">
                    {amount ? `${amount} credits` : pkg.product.title}
                  </ThemedText>
                  {isPurchasing ? (
                    <ActivityIndicator />
                  ) : (
                    <ThemedText type="mono">{pkg.product.priceString}</ThemedText>
                  )}
                </ThemedView>
              </Pressable>
            );
          })}
        </View>

        {waitingForCredit && <ThemedText themeColor="textSecondary">Confirming purchase…</ThemedText>}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: Radius.medium,
  },
  rowInner: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
