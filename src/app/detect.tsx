import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFlow } from '@/state/flow-context';

const MOCK_DETECTION_DELAY = 1200;

export default function DetectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { photoUri, runDetection } = useFlow();

  useEffect(() => {
    const timer = setTimeout(() => {
      const succeeded = runDetection();
      router.replace(succeeded ? '/correct' : '/detect-failed');
    }, MOCK_DETECTION_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.imageWrapper}>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.image} contentFit="cover" />}
          <View style={[styles.overlay, { backgroundColor: theme.primaryDark + 'AA' }]}>
            <ActivityIndicator color={theme.onPrimary} size="large" />
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
              Detecting the leash…
            </ThemedText>
          </View>
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
    padding: Spacing.four,
    justifyContent: 'center',
  },
  imageWrapper: {
    aspectRatio: 3 / 4,
    borderRadius: Radius.large,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
});
