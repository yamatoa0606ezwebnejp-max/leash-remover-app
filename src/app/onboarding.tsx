import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useFlow } from '@/state/flow-context';

const POINTS = [
  {
    title: 'Your photo stays on this device',
    body: 'We use the photo you select only to detect and remove the leash.',
  },
  {
    title: 'Nothing is shared automatically',
    body: 'The exported photo stays private until you choose to save or share it.',
  },
  {
    title: 'Review this anytime',
    body: 'You can revisit this privacy notice from Settings at any time.',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding } = useFlow();

  function handleStart() {
    completeOnboarding();
    router.replace('/');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">LeashOff</ThemedText>
          <ThemedText themeColor="textSecondary">
            Before you start, here&apos;s how we handle your photos.
          </ThemedText>
        </View>

        <View style={styles.list}>
          {POINTS.map((point) => (
            <ThemedView type="backgroundElement" key={point.title} style={styles.card}>
              <ThemedText type="smallBold">{point.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {point.body}
              </ThemedText>
            </ThemedView>
          ))}
        </View>

        <Button title="Get Started" onPress={handleStart} />
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
  header: {
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.three,
  },
  card: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
