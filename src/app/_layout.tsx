import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { FlowProvider } from '@/state/flow-context';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <FlowProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.background },
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="detect" options={{ gestureEnabled: false }} />
          <Stack.Screen name="detect-failed" />
          <Stack.Screen name="correct" />
          <Stack.Screen name="processing" options={{ gestureEnabled: false }} />
          <Stack.Screen name="compare" />
          <Stack.Screen name="export" />
          <Stack.Screen name="purchase" options={{ presentation: 'modal' }} />
        </Stack>
      </FlowProvider>
    </ThemeProvider>
  );
}
