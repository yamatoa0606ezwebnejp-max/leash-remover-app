import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesError, PurchasesPackage } from 'react-native-purchases';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { CREDIT_PACK_PRODUCT_IDS, Purchases, isPurchasesConfigured } from '@/lib/purchases';
import { useFlow } from '@/state/flow-context';

// Purchased credits are granted server-side once RevenueCat's webhook fires
// (see supabase/functions/revenuecat-webhook), so after purchasePackage()
// resolves we don't know the new balance yet — poll refreshCredits() a few
// times with backoff instead of trusting a client-side amount.
async function waitForCreditIncrease(refreshCredits: () => Promise<number>, before: number) {
  const delaysMs = [500, 1000, 2000, 3000, 5000];
  for (const delay of delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const balance = await refreshCredits();
    if (balance > before) return true;
  }
  return false;
}

export default function PurchaseScreen() {
  const router = useRouter();
  const { credits, refreshCredits } = useFlow();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(isPurchasesConfigured());
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [waitingForCredit, setWaitingForCredit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    isPurchasesConfigured() ? null : 'Purchases are not configured yet.',
  );

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
      setErrorMessage(null);
      setPurchasingId(pkg.identifier);
      const creditsBefore = credits;
      try {
        await Purchases.purchasePackage(pkg);
        setPurchasingId(null);
        setWaitingForCredit(true);
        const credited = await waitForCreditIncrease(refreshCredits, creditsBefore);
        setWaitingForCredit(false);
        if (credited) {
          router.back();
        } else {
          setErrorMessage(
            'Purchase completed, but your balance hasn’t updated yet. Pull back into this screen in a moment.',
          );
        }
      } catch (error) {
        setPurchasingId(null);
        setWaitingForCredit(false);
        if ((error as Partial<PurchasesError>)?.userCancelled) return;
        setErrorMessage('Purchase failed. Please try again.');
      }
    },
    [credits, refreshCredits, router],
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Buy Credits" onBack={() => router.back()} />

        <ThemedText themeColor="textSecondary">
          Print exports require credits.{'\n'}Current balance: {credits}
        </ThemedText>

        {loadingOfferings && <ActivityIndicator />}
        {errorMessage && <ThemedText themeColor="textSecondary">{errorMessage}</ThemedText>}

        <View style={styles.list}>
          {packages.map((pkg) => {
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
