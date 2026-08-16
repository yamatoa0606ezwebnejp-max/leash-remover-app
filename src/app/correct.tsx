import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFlow } from '@/state/flow-context';

export default function CorrectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { photoUri, highlights, toggleHighlight, addHighlightAt } = useFlow();
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });

  const includedCount = highlights.filter((h) => h.included).length;

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setImageSize({ width, height });
  }

  function handleBackgroundPress(event: GestureResponderEvent) {
    const { locationX, locationY } = event.nativeEvent;
    addHighlightAt(locationX / imageSize.width, locationY / imageSize.height);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title="Review Detection"
          subtitle="Tap to include or exclude an area"
          onBack={() => router.back()}
        />

        <Pressable onPress={handleBackgroundPress} onLayout={handleLayout} style={styles.imageWrapper}>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.image} contentFit="cover" />}
          {highlights.map((highlight) => (
            <Pressable
              key={highlight.id}
              onPress={(event) => {
                event.stopPropagation();
                toggleHighlight(highlight.id);
              }}
              style={[
                styles.highlight,
                {
                  left: `${highlight.left * 100}%`,
                  top: `${highlight.top * 100}%`,
                  width: `${highlight.width * 100}%`,
                  height: `${highlight.height * 100}%`,
                  borderColor: highlight.included ? theme.accentLight : theme.textSecondary,
                  backgroundColor: highlight.included ? theme.accentLight + '40' : 'transparent',
                },
              ]}
            />
          ))}
        </Pressable>

        {highlights.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Tap the photo to mark the leash area
          </ThemedText>
        )}

        <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary">
            {includedCount} area(s) selected for removal
          </ThemedText>
          <Button
            title="Remove Leash"
            disabled={includedCount === 0}
            onPress={() => router.push('/processing')}
          />
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
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: Radius.small,
  },
  hint: {
    textAlign: 'center',
  },
  footer: {
    gap: Spacing.two,
    alignItems: 'center',
  },
});
