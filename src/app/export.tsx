import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
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

// content_type is e.g. "image/png" or "image/jpeg" — MediaLibrary's
// Asset.create() infers the asset type from the file's extension, so the
// temp file needs a real one, not just a random name.
function extensionForContentType(contentType: string) {
  const subtype = contentType.split('/')[1] ?? 'jpg';
  return subtype === 'jpeg' ? 'jpg' : subtype;
}

export default function ExportScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { isSignedIn, credits, consumeCredit, runPrintRender, removalResult } = useFlow();
  const [preset, setPreset] = useState<(typeof PRINT_PRESETS)[number]['id']>('square');
  const [isExportingStandard, setIsExportingStandard] = useState(false);
  const [isExportingPrint, setIsExportingPrint] = useState(false);

  async function saveToCameraRoll(imageBase64: string, contentType: string) {
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Allow photo library access in Settings to save your export.',
      );
      return false;
    }

    // Asset.create() needs a real file on disk — it can't take base64
    // directly, so write it to a throwaway cache file first.
    const file = new File(Paths.cache, `leashoff-${Date.now()}.${extensionForContentType(contentType)}`);
    file.create();
    file.write(imageBase64, { encoding: 'base64' });
    try {
      await MediaLibrary.Asset.create(file.uri);
      return true;
    } finally {
      file.delete();
    }
  }

  async function handleStandardExport() {
    // The F-05 render already produced this image at standard resolution —
    // this is that same result, not a fresh server call.
    if (!removalResult) return;
    setIsExportingStandard(true);
    try {
      const saved = await saveToCameraRoll(removalResult.imageBase64, removalResult.contentType);
      if (saved) {
        Alert.alert('Exported', 'Your standard export (free) was saved to Photos.');
      }
    } catch (error) {
      console.warn('saveToCameraRoll (standard) failed', error);
      Alert.alert('Export failed', 'Could not save the photo. Please try again.');
    } finally {
      setIsExportingStandard(false);
    }
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
      try {
        const saved = await saveToCameraRoll(result.imageBase64, result.contentType);
        if (saved) {
          Alert.alert(
            'Exported',
            charged
              ? 'Your print export was saved to Photos. 1 credit was used.'
              : 'Your print export was saved to Photos.',
          );
        }
      } catch (error) {
        console.warn('saveToCameraRoll (print) failed', error);
        Alert.alert(
          'Save failed',
          charged
            ? 'The export rendered and your credit was used, but saving to Photos failed. Please try again.'
            : 'The export rendered, but saving to Photos failed. Please try again.',
        );
      }
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
              title={isExportingStandard ? 'Saving…' : 'Export'}
              variant="secondary"
              disabled={!removalResult || isExportingStandard}
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
