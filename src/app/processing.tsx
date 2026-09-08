import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { InsufficientCreditsError } from '@/lib/leash-api';
import { useFlow } from '@/state/flow-context';

export default function ProcessingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { runRemoval } = useFlow();

  useEffect(() => {
    let cancelled = false;
    runRemoval()
      .then((succeeded) => {
        if (cancelled) return;
        router.replace(succeeded ? '/compare' : '/detect-failed');
      })
      .catch((error) => {
        if (cancelled) return;
        // correct.tsx already keeps a signed-out or out-of-credit user from
        // reaching this screen, so this is the race-condition fallback (the
        // balance or session changed between that check and this call) —
        // same 402 the print path handles in export.tsx.
        if (error instanceof InsufficientCreditsError) {
          router.replace('/purchase');
          return;
        }
        console.warn('runRemoval failed unexpectedly', error);
        router.replace('/detect-failed');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color={theme.primary} size="large" />
        <ThemedText type="display" style={styles.centerText}>
          Removing the leash
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          This will just take a moment…
        </ThemedText>
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
});
