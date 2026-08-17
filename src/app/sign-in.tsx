import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFlow } from '@/state/flow-context';

// TODO(App Review, Guideline 5.1.1(v)): once a backend/account exists behind
// this sign-in, add an in-app account deletion flow (planned home: the
// future Settings screen referenced in onboarding.tsx). Nothing to delete
// yet since there's no persisted account data, but flag before submission.

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useFlow();
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);

  async function handleSignIn() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      signIn(credential.user);
      router.back();
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Sign in failed', 'Please try again.');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">Sign In</ThemedText>
          <ThemedText themeColor="textSecondary">
            Sign in with Apple to claim your free print credit and keep your credits and purchase
            history if you ever reinstall LeashOff.
          </ThemedText>
        </View>

        <View style={styles.actions}>
          {available && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={14}
              style={styles.appleButton}
              onPress={handleSignIn}
            />
          )}
          {available === false && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              Sign in with Apple isn&apos;t available on this device.
            </ThemedText>
          )}
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
  header: {
    gap: Spacing.two,
  },
  actions: {
    alignItems: 'center',
  },
  appleButton: {
    width: '100%',
    height: 50,
  },
  centerText: {
    textAlign: 'center',
  },
});
