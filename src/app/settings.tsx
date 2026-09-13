import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFlow } from '@/state/flow-context';

export default function SettingsScreen() {
  const router = useRouter();
  const { isSignedIn, signOut, deleteAccount, subscriptionTier } = useFlow();
  const [isWorking, setIsWorking] = useState(false);

  async function handleSignOut() {
    setIsWorking(true);
    try {
      await signOut();
    } finally {
      setIsWorking(false);
    }
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account?',
      'This permanently deletes your account, including your remaining credits and purchase history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsWorking(true);
            try {
              await deleteAccount();
              router.back();
            } catch {
              Alert.alert('Something went wrong', 'Please try again.');
            } finally {
              setIsWorking(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Settings" onBack={() => router.back()} />

        <ThemedText themeColor="textSecondary">
          Your photo is never stored — it&apos;s sent securely to remove the leash, then discarded
          immediately. The exported photo stays private until you choose to save or share it.
        </ThemedText>

        {isWorking && <ActivityIndicator />}

        {isSignedIn ? (
          <View style={styles.actions}>
            {subscriptionTier !== 'free' && (
              // Downgrading to Free means cancelling the subscription, which
              // is always Apple's own subscription-management screen, not
              // something this app can do itself (or should — cancellation
              // is a StoreKit-level action, not a Supabase one).
              <Button
                title="Manage Subscription"
                variant="secondary"
                onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
              />
            )}
            <Button title="Sign Out" variant="secondary" onPress={handleSignOut} disabled={isWorking} />
            <Button
              title="Delete Account"
              variant="outline"
              onPress={handleDeleteAccount}
              disabled={isWorking}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <ThemedText themeColor="textSecondary">
              Sign in with Apple to manage your account.
            </ThemedText>
            <Button title="Sign in with Apple" onPress={() => router.push('/sign-in')} />
          </View>
        )}
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
    gap: Spacing.four,
  },
  actions: {
    gap: Spacing.two,
  },
});
