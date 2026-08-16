import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFlow } from '@/state/flow-context';

export default function DetectFailedScreen() {
  const router = useRouter();
  const { resetFlow } = useFlow();

  function handlePickAgain() {
    resetFlow();
    router.replace('/');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.body}>
          <ThemedText type="display" style={styles.centerText}>
            Couldn&apos;t detect a leash
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            This can happen depending on the angle or lighting in the photo.{'\n'}
            Try marking the area manually, or pick a different photo.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            No credit was used
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <Button title="Correct Manually" onPress={() => router.replace('/correct')} />
          <Button title="Choose a Different Photo" variant="outline" onPress={handlePickAgain} />
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
    paddingVertical: Spacing.five,
    justifyContent: 'space-between',
  },
  body: {
    gap: Spacing.three,
    marginTop: Spacing.six,
  },
  centerText: {
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.two,
  },
});
