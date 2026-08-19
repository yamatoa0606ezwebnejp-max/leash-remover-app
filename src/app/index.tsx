import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { isLeashApiConfigured, warmLeashApi } from '@/lib/leash-api';
import { useFlow } from '@/state/flow-context';

export default function PhotoSelectScreen() {
  const router = useRouter();
  const { hasSeenOnboarding, pickPhoto } = useFlow();

  if (!hasSeenOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Please allow access to your photo library in Settings.');
      return;
    }

    // Fire-and-forget: buys back most of the ~34s cold start (see
    // leash-remover-api's docs/api.md) while the user is still picking and
    // tapping. Not awaited — a failure here just means the first real call
    // pays the full cold start instead.
    if (isLeashApiConfigured()) {
      warmLeashApi().catch(() => {});
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
