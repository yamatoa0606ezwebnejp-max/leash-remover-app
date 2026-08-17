import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * In-memory mock state for the photo → detect → correct → remove → export
 * flow. No persistence and no real detection/removal — see
 * screen-implementation-handoff.md section 5 for what's explicitly out of
 * scope (RevenueCat, image processing API, credit persistence).
 */

export type Highlight = {
  id: string;
  left: number; // 0–1, fraction of the image container
  top: number;
  width: number;
  height: number;
  included: boolean;
};

// Granted once, on first sign-in — not on app launch — so the free credit
// stays tied to an identity rather than a device/install. See the
// appleUserId/signIn comment in FlowState for why this alone isn't enough.
const STARTING_CREDITS = 1;
const DETECTION_FAILURE_RATE = 0.15;
const HIGHLIGHT_SIZE = { width: 0.24, height: 0.14 };

function randomHighlights(): Highlight[] {
  const count = 2 + Math.floor(Math.random() * 2); // 2–3
  return Array.from({ length: count }, (_, index) => ({
    id: `mock-${Date.now()}-${index}`,
    left: 0.1 + Math.random() * 0.6,
    top: 0.15 + Math.random() * 0.6,
    ...HIGHLIGHT_SIZE,
    included: true,
  }));
}

type FlowState = {
  hasSeenOnboarding: boolean;
  completeOnboarding: () => void;

  photoUri: string | null;
  pickPhoto: (uri: string) => void;

  highlights: Highlight[];
  detectionFailed: boolean;
  runDetection: () => boolean;
  toggleHighlight: (id: string) => void;
  addHighlightAt: (left: number, top: number) => void;

  devForceDetectionFailure: boolean;
  setDevForceDetectionFailure: (value: boolean) => void;

  // Sign in with Apple identity, gating print credits. Purpose: (1) prevent
  // free-credit reuse via reinstall, (2) prevent loss of paid consumable
  // credits on reinstall (Apple's Restore Purchases can't recover them).
  //
  // SCOPE GAP: this is entry-point-only. appleUserId lives in memory like
  // the rest of this mock state, so it resets on every app restart, and
  // signIn() below can only tell if an id is new to *this* in-memory
  // session — not whether the real person has ever signed in before. Until
  // the id is persisted and checked server-side (separate task, alongside
  // RevenueCat logIn()), goals (1) and (2) are NOT achieved: closing and
  // reopening the app and signing in again with the same Apple ID re-grants
  // the free credit. That's not merely "no better than before" — before,
  // abuse required an uninstall; now it only requires a restart.
  appleUserId: string | null;
  isSignedIn: boolean;
  signIn: (appleUserId: string) => void;
  signOut: () => void;

  credits: number;
  consumeCredit: () => boolean;
  addCredits: (amount: number) => void;

  resetFlow: () => void;
};

const FlowContext = createContext<FlowState | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [devForceDetectionFailure, setDevForceDetectionFailure] = useState(false);
  const [appleUserId, setAppleUserId] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);

  const completeOnboarding = useCallback(() => setHasSeenOnboarding(true), []);

  const pickPhoto = useCallback((uri: string) => {
    setPhotoUri(uri);
    setHighlights([]);
    setDetectionFailed(false);
  }, []);

  const runDetection = useCallback(() => {
    const failed = devForceDetectionFailure || Math.random() < DETECTION_FAILURE_RATE;
    setDetectionFailed(failed);
    setHighlights(failed ? [] : randomHighlights());
    setDevForceDetectionFailure(false);
    return !failed;
  }, [devForceDetectionFailure]);

  const toggleHighlight = useCallback((id: string) => {
    setHighlights((current) =>
      current.map((highlight) =>
        highlight.id === id ? { ...highlight, included: !highlight.included } : highlight,
      ),
    );
  }, []);

  const addHighlightAt = useCallback((left: number, top: number) => {
    setHighlights((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        left: Math.min(Math.max(left - HIGHLIGHT_SIZE.width / 2, 0), 1 - HIGHLIGHT_SIZE.width),
        top: Math.min(Math.max(top - HIGHLIGHT_SIZE.height / 2, 0), 1 - HIGHLIGHT_SIZE.height),
        ...HIGHLIGHT_SIZE,
        included: true,
      },
    ]);
  }, []);

  const addCredits = useCallback((amount: number) => {
    setCredits((current) => current + amount);
  }, []);

  const signIn = useCallback(
    (id: string) => {
      setAppleUserId((current) => {
        if (current === null) addCredits(STARTING_CREDITS);
        return id;
      });
    },
    [addCredits],
  );

  const signOut = useCallback(() => setAppleUserId(null), []);

  const consumeCredit = useCallback(() => {
    let success = false;
    setCredits((current) => {
      if (current <= 0) return current;
      success = true;
      return current - 1;
    });
    return success;
  }, []);

  const resetFlow = useCallback(() => {
    setPhotoUri(null);
    setHighlights([]);
    setDetectionFailed(false);
  }, []);

  const value = useMemo<FlowState>(
    () => ({
      hasSeenOnboarding,
      completeOnboarding,
      photoUri,
      pickPhoto,
      highlights,
      detectionFailed,
      runDetection,
      toggleHighlight,
      addHighlightAt,
      devForceDetectionFailure,
      setDevForceDetectionFailure,
      appleUserId,
      isSignedIn: appleUserId !== null,
      signIn,
      signOut,
      credits,
      consumeCredit,
      addCredits,
      resetFlow,
    }),
    [
      hasSeenOnboarding,
      completeOnboarding,
      photoUri,
      pickPhoto,
      highlights,
      detectionFailed,
      runDetection,
      toggleHighlight,
      addHighlightAt,
      devForceDetectionFailure,
      appleUserId,
      signIn,
      signOut,
      credits,
      consumeCredit,
      addCredits,
      resetFlow,
    ],
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const context = useContext(FlowContext);
  if (!context) throw new Error('useFlow must be used within a FlowProvider');
  return context;
}
