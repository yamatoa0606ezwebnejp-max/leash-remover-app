import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFlow } from '@/state/flow-context';

export default function CompareScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { photoUri } = useFlow();
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Before & After" onBack={() => router.back()} />

        <Pressable
          onPressIn={() => setShowOriginal(true)}
          onPressOut={() => setShowOriginal(false)}
          style={styles.imageWrapper}>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.image} contentFit="cover" />}
          {!showOriginal && (
            <View style={[styles.processedTint, { backgroundColor: theme.primary + '26' }]} />
          )}
          <View style={[styles.badge, { backgroundColor: theme.primaryDark + 'CC' }]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
              {showOriginal ? 'Before' : 'After'}
            </ThemedText>
          </View>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          Press and hold to see the original (mock preview)
        </ThemedText>

        <View style={styles.footer}>
          <Button
            title="Start Over"
            variant="outline"
            onPress={() => router.replace('/correct')}
            style={styles.footerButton}
          />
          <Button title="Next" onPress={() => router.push('/export')} style={styles.footerButton} />
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
    gap: Spacing.three,
  },
  imageWrapper: {
    flex: 1,
    borderRadius: Radius.large,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
  processedTint: {
    ...StyleSheet.absoluteFill,
  },
  badge: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  footerButton: {
    flex: 1,
  },
});
