import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFlow, type TapPoint } from '@/state/flow-context';

const MAX_TAP_POINTS = 8;

// All rejection reasons read the same to a user except grabbed_dog, which
// gets its own wording — see leash-remover-api's docs/api.md.
const REASON_HINTS: Record<NonNullable<TapPoint['reason']>, string> = {
  no_mask: "That tap didn't land on the lead — try again.",
  too_large: "That tap didn't land on the lead — try again.",
  grabbed_person: "That tap didn't land on the lead — try again.",
  grabbed_dog: 'That landed on the dog — try moving it a few pixels.',
};

function TapMarker({ point, onPress }: { point: TapPoint; onPress: () => void }) {
  const theme = useTheme();
  const color =
    point.status === 'accepted' ? theme.accentLight : point.status === 'rejected' ? theme.danger : theme.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={[styles.tapMarker, { left: `${point.xNorm * 100}%`, top: `${point.yNorm * 100}%`, borderColor: color, backgroundColor: color + '33' }]}>
      {point.status === 'pending' && <ActivityIndicator size="small" color={color} />}
      {point.status === 'accepted' && (
        <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} tintColor={color} size={14} />
      )}
      {point.status === 'rejected' && (
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} tintColor={color} size={14} />
      )}
    </Pressable>
  );
}

export default function CorrectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    photoUri,
    photoWidth,
    photoHeight,
    tapPoints,
    addTapAt,
    removeTap,
    isPreviewLoading,
    anyAccepted,
    dogDetected,
    coverageComplete,
    continueAtNorm,
  } = useFlow();

  const acceptedCount = tapPoints.filter((point) => point.status === 'accepted').length;
  const atMax = tapPoints.length >= MAX_TAP_POINTS;
  const lastRejected = [...tapPoints].reverse().find((point) => point.status === 'rejected');
  const aspectRatio = photoWidth > 0 && photoHeight > 0 ? photoWidth / photoHeight : 3 / 4;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title="Tap the Leash"
          subtitle="Tap once on the leash — add more taps if it's not fully covered"
          onBack={() => router.back()}
        />

        <TapImage
          photoUri={photoUri}
          aspectRatio={aspectRatio}
          tapPoints={tapPoints}
          continueAtNorm={coverageComplete ? [] : continueAtNorm}
          atMax={atMax}
          onTap={addTapAt}
          onRemoveTap={removeTap}
        />

        <View style={styles.hintArea}>
          {tapPoints.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              Tap the leash in the photo (up to {MAX_TAP_POINTS} points)
            </ThemedText>
          )}
          {lastRejected && (
            <ThemedText type="small" style={[styles.centerText, { color: theme.danger }]}>
              {REASON_HINTS[lastRejected.reason ?? 'no_mask']}
            </ThemedText>
          )}
          {!coverageComplete && continueAtNorm.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              The lead looks like it keeps going — tap to continue marking it.
            </ThemedText>
          )}
          {dogDetected === false && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              We couldn&apos;t find a dog in this photo.
            </ThemedText>
          )}
          {atMax && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {MAX_TAP_POINTS} points marked — remove one to add another.
            </ThemedText>
          )}
        </View>

        <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary">
            {isPreviewLoading ? 'Checking…' : `${acceptedCount} point(s) marked for removal`}
          </ThemedText>
          <Button
            title="Remove Leash"
            disabled={!anyAccepted || isPreviewLoading}
            onPress={() => router.push('/processing')}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

// Split out so the Pressable's onLayout can hand back real pixel dimensions
// for converting a tap into a 0–1 fraction — event.nativeEvent.locationX/Y
// are in points relative to the element, so this is exact, not approximate.
function TapImage({
  photoUri,
  aspectRatio,
  tapPoints,
  continueAtNorm,
  atMax,
  onTap,
  onRemoveTap,
}: {
  photoUri: string | null;
  aspectRatio: number;
  tapPoints: TapPoint[];
  continueAtNorm: { x: number; y: number }[];
  atMax: boolean;
  onTap: (xNorm: number, yNorm: number) => void;
  onRemoveTap: (id: string) => void;
}) {
  const theme = useTheme();
  const sizeRef = useRef({ width: 1, height: 1 });

  function handlePress(event: GestureResponderEvent) {
    if (atMax) return;
    const { locationX, locationY } = event.nativeEvent;
    const { width, height } = sizeRef.current;
    onTap(Math.min(Math.max(locationX / width, 0), 1), Math.min(Math.max(locationY / height, 0), 1));
  }

  return (
    <Pressable
      onPress={handlePress}
      onLayout={(event) => {
        sizeRef.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
      }}
      style={[styles.imageWrapper, { aspectRatio }]}>
      {photoUri && <Image source={{ uri: photoUri }} style={styles.image} contentFit="cover" />}
      {continueAtNorm.map((point, index) => (
        <View
          key={`hint-${index}`}
          pointerEvents="none"
          style={[
            styles.continueHint,
            { left: `${point.x * 100}%`, top: `${point.y * 100}%`, borderColor: theme.textSecondary },
          ]}
        />
      ))}
      {tapPoints.map((point) => (
        <TapMarker key={point.id} point={point} onPress={() => onRemoveTap(point.id)} />
      ))}
    </Pressable>
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
    width: '100%',
    borderRadius: Radius.large,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
  tapMarker: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueHint: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  hintArea: {
    minHeight: Spacing.six,
    gap: Spacing.one,
    justifyContent: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  footer: {
    gap: Spacing.two,
    alignItems: 'center',
  },
});
