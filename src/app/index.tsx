import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { warmLeashApi } from '@/lib/leash-api';
import { useFlow } from '@/state/flow-context';

export default function PhotoSelectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { hasSeenOnboarding, pickPhoto, credits, subscriptionTier } = useFlow();

  if (!hasSeenOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Please allow access to your photo library in Settings.');
      return;
    }

    // Tiered warm timing (project memory project_leashoff_billing_v2_redesign,
    // decided 2026-09-05/06, generalized to 3 tiers 2026-09-11): both paid
    // tiers (standard and premium) get a warm call here, fired before the
    // native picker opens so its browsing time doubles as cold-start-hiding
    // buffer — the only point in this flow where that buffer exists (the
    // picker closes before pickPhoto/first-tap fire, so warming at either of
    // those points has no lead time left to use). Free tier gets no warm
    // call at all: every warm costs real Cloud Run money whether or not the
    // user goes on to actually render, so it's gated behind a paid tier
    // rather than fired speculatively for everyone. Fire-and-forget: a
    // failed/slow warm should never block opening the picker.
    if (subscriptionTier !== 'free') {
      warmLeashApi().catch((error) => console.warn('warmLeashApi failed', error));
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    pickPhoto(asset.uri, asset.width, asset.height);
    router.push('/correct');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          onPress={() => router.push('/purchase')}
          hitSlop={12}
          style={({ pressed }) => [
            styles.creditsButton,
            { top: insets.top + Spacing.four, opacity: pressed ? 0.6 : 1 },
          ]}>
          <ThemedText type="small" themeColor="textSecondary">
            {credits} credit{credits === 1 ? '' : 's'}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={12}
          style={({ pressed }) => [
            styles.settingsButton,
            // Absolutely positioned children ignore SafeAreaView's own
            // padding in RN's layout engine, so without adding insets.top
            // here this button renders under the notch/Dynamic Island on
            // devices with a large top inset (TestFlight feedback: gear
            // icon overlapping the status bar).
            { top: insets.top + Spacing.four, opacity: pressed ? 0.6 : 1 },
          ]}>
          <SymbolView
            name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
            tintColor={theme.textSecondary}
            size={22}
          />
        </Pressable>

        <View style={styles.hero}>
          <ThemedText type="title" style={styles.centerText}>
            LeashOff
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Remove the leash from your walk photos{'\n'}for a clean, camera-roll-ready shot.
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <Button title="Choose from Camera Roll" onPress={handlePickPhoto} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            Select one photo
          </ThemedText>
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
    justifyContent: 'center',
    gap: Spacing.six,
  },
  settingsButton: {
    position: 'absolute',
    right: Spacing.four,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditsButton: {
    position: 'absolute',
    left: Spacing.four,
    height: 32,
    justifyContent: 'center',
  },
  hero: {
    gap: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.two,
    alignItems: 'center',
  },
});
