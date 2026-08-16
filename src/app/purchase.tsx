import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useFlow } from '@/state/flow-context';

const CREDIT_PACKS = [
  { amount: 3, price: '$2.99' },
  { amount: 10, price: '$7.99' },
  { amount: 20, price: '$14.99' },
];

export default function PurchaseScreen() {
  const router = useRouter();
  const { credits, addCredits } = useFlow();

  function handlePurchase(amount: number) {
    addCredits(amount);
    router.back();
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Buy Credits" onBack={() => router.back()} />

        <ThemedText themeColor="textSecondary">
          Print exports require credits.{'\n'}Current balance: {credits}
        </ThemedText>

        <View style={styles.list}>
          {CREDIT_PACKS.map((pack) => (
            <Pressable
              key={pack.amount}
              onPress={() => handlePurchase(pack.amount)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
              <ThemedView type="backgroundElement" style={styles.rowInner}>
                <ThemedText type="smallBold">{pack.amount} credits</ThemedText>
                <ThemedText type="mono">{pack.price}</ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>
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
