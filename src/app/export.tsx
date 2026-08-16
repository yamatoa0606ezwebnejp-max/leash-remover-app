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
  const { credits, consumeCredit } = useFlow();
  const [preset, setPreset] = useState<(typeof PRINT_PRESETS)[number]['id']>('square');

  function handleStandardExport() {
    Alert.alert('Exported', 'Your standard export (free) is complete.');
  }

  function handlePrintExport() {
    const success = consumeCredit();
    if (!success) {
      router.push('/purchase');
      return;
    }
    Alert.alert('Exported', 'Your print export is complete. 1 credit was used.');
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
            <Button title="Export" variant="secondary" onPress={handleStandardExport} />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold">Print Export</ThemedText>
              <ThemedText type="mono" themeColor="textSecondary">
                {credits} left
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Paid credit · print-ready resolution
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

            <Button title="Export" onPress={handlePrintExport} />
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
