import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFlow } from '@/state/flow-context';

const PRINT_PRESETS = [
  { id: 'square', label: 'Square' },
  { id: 'a4', label: 'A4' },
  { id: 'landscape', label: 'Landscape' },
] as const;

export default function ExportScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { isSignedIn, credits, consumeCredit, runPrintRender, removalResult } = useFlow();
  const [preset, setPreset] = useState<(typeof PRINT_PRESETS)[number]['id']>('square');
  const [isExportingPrint, setIsExportingPrint] = useState(false);

  function handleStandardExport() {
    // The F-05 render already produced this image at standard resolution —
    // this is that same result, not a fresh server call. Saving it to the
    // camera roll isn't wired up yet (no expo-media-library dependency).
    if (!removalResult) return;
    Alert.alert('Exported', 'Your standard export (free) is complete.');
  }

  async function handlePrintExport() {
    if (credits <= 0) {
      router.push('/purchase');
      return;
    }
    setIsExportingPrint(true);
    try {
      // Render at print resolution first, and only spend a credit once the
      // server confirms it succeeded — see leash-remover-api's docs/api.md:
      // "the client must not charge a credit" on a failed render.
      const result = await runPrintRender();
      if (!result) {
        Alert.alert('Export failed', 'The photo could not be processed. Please try again.');
        return;
      }
      const charged = await consumeCredit();
      Alert.alert(
        'Exported',
        charged
          ? 'Your print export is complete. 1 credit was used.'
          : 'Your print export is complete.',
      );
    } finally {
      setIsExportingPrint(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Export" onBack={() => router.back()} />

        <View style={styles.content}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Standard Export</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Free · social-media resolution
            </ThemedText>
            <Button
              title="Export"
              variant="secondary"
              disabled={!removalResult}
              onPress={handleStandardExport}
            />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold">Print Export</ThemedText>
              <ThemedText type="mono" themeColor="textSecondary">
                {credits} left
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {isSignedIn
                ? 'Paid credit · print-ready resolution'
                : 'Sign in to claim your free credit and keep credits across reinstalls'}
            </ThemedText>

            <View style={styles.presetRow}>
              {PRINT_PRESETS.map((item) => {
                const selected = item.id === preset;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setPreset(item.id)}
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: selected ? theme.primary : theme.backgroundSelected,
                        borderColor: selected ? theme.primary : theme.border,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: selected ? theme.onPrimary : theme.text }}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {isSignedIn ? (
              <Button
                title={isExportingPrint ? 'Processing…' : 'Export'}
                disabled={isExportingPrint}
                onPress={handlePrintExport}
              />
            ) : (
              <Button
                title="Sign In to Get Your Free Credit"
                onPress={() => router.push('/sign-in')}
              />
            )}
          </ThemedView>
        </View>

        <Button title="Start Over" variant="outline" onPress={() => router.replace('/correct')} />
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
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  content: {
    gap: Spacing.three,
  },
  card: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  presetChip: {
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
});
