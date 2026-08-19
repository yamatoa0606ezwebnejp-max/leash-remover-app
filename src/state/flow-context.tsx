import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  previewLeashTaps,
  renderLeashRemoval,
  type Point,
  type TapPreview,
} from '@/lib/leash-api';
import { supabase } from '@/lib/supabase';
import { isPurchasesConfigured, Purchases } from '@/lib/purchases';

// RevenueCat's app_user_id must equal the Supabase user id, so that the
// revenuecat-webhook Edge Function can credit the right account server-side
// after a real purchase (see supabase/functions/revenuecat-webhook). If
// RevenueCat isn't configured yet (no API key / non-iOS), skip silently —
// the rest of the identity/credit flow still works, purchases just won't
// verify until RevenueCat is set up.
async function linkPurchasesIdentity(userId: string) {
  if (!isPurchasesConfigured()) return;
  try {
    await Purchases.logIn(userId);
  } catch (error) {
    console.warn('Purchases.logIn failed', error);
  }
}

async function unlinkPurchasesIdentity() {
  if (!isPurchasesConfigured()) return;
  try {
    await Purchases.logOut();
  } catch (error) {
    console.warn('Purchases.logOut failed', error);
  }
}

export type TapPoint = {
  id: string;
  xNorm: number; // 0–1, fraction of the photo (not the on-screen container)
  yNorm: number;
  status: 'pending' | 'accepted' | 'rejected';
  reason: TapPreview['reason'];
};

export type RemovalResult = {
  imageBase64: string;
  contentType: string;
};

const MAX_TAP_POINTS = 8;

function toPixelPoints(points: TapPoint[], width: number, height: number): Point[] {
  return points.map((p) => ({ x: p.xNorm * width, y: p.yNorm * height }));
}

type FlowState = {
  hasSeenOnboarding: boolean;
  completeOnboarding: () => void;

  photoUri: string | null;
  photoWidth: number;
  photoHeight: number;
  pickPhoto: (uri: string, width: number, height: number) => void;

  // Leash detection is tap-driven, not automatic — the server's leash
  // pipeline is a SAM point prompt per tap (see leash-remover-api's
  // README: "every attempt to detect the leash directly failed"). Each tap
  // is scored independently by the server, but the whole current point set
  // is resent on every add/remove so coverage_complete/continue_at reflect
  // everything accepted so far.
  tapPoints: TapPoint[];
  addTapAt: (xNorm: number, yNorm: number) => void;
  removeTap: (id: string) => void;
  isPreviewLoading: boolean;
  anyAccepted: boolean;
  dogDetected: boolean | null;
  coverageComplete: boolean;
  continueAtNorm: { x: number; y: number }[];

  isRemoving: boolean;
  removalResult: RemovalResult | null;
  // F-05: renders at "standard" resolution, which doubles as the free F-07
  // export — see export.tsx. Returns whether it succeeded (F-10 on false).
  runRemoval: () => Promise<boolean>;
  // F-08: a fresh "print" resolution render, called only once a credit is
  // confirmed available — see export.tsx for why credits are consumed
  // after this succeeds, not before.
  runPrintRender: () => Promise<RemovalResult | null>;

  // Sign in with Apple identity, gating print credits. Purpose: (1) prevent
  // free-credit reuse via reinstall, (2) prevent loss of paid consumable
  // credits on reinstall (Apple's Restore Purchases can't recover them).
  //
  // Identity + credits are persisted via Supabase (session in AsyncStorage,
  // balance in Postgres — see supabase/schema.sql), not local state, so
  // both goals above actually hold: the free credit can only be claimed
  // once per Supabase user (claim_free_credit() is atomic and checks
  // free_credit_claimed server-side), and balance survives reinstall as
  // long as the user signs back in with the same Apple ID.
  //
  // Purchased credits are verified: RevenueCat confirms the purchase and a
  // Supabase Edge Function (supabase/functions/revenuecat-webhook) credits
  // the account server-side, keyed on RevenueCat's app_user_id (== this
  // Supabase user id, see linkPurchasesIdentity below). The client cannot
  // grant itself credits directly anymore.
  appleUserId: string | null;
  isSignedIn: boolean;
  signIn: (identityToken: string, rawNonce: string) => Promise<void>;
  signOut: () => Promise<void>;

  credits: number;
  consumeCredit: () => Promise<boolean>;
  refreshCredits: () => Promise<number>;

  resetFlow: () => void;
};

const FlowContext = createContext<FlowState | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoWidth, setPhotoWidth] = useState(0);
  const [photoHeight, setPhotoHeight] = useState(0);

  const [tapPoints, setTapPoints] = useState<TapPoint[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [anyAccepted, setAnyAccepted] = useState(false);
  const [dogDetected, setDogDetected] = useState<boolean | null>(null);
  const [coverageComplete, setCoverageComplete] = useState(false);
  const [continueAtNorm, setContinueAtNorm] = useState<{ x: number; y: number }[]>([]);

  const [isRemoving, setIsRemoving] = useState(false);
  const [removalResult, setRemovalResult] = useState<RemovalResult | null>(null);

  const [appleUserId, setAppleUserId] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);

  const fetchCredits = useCallback(async (userId: string) => {
    const { data } = await supabase.from('credits').select('balance').eq('user_id', userId).maybeSingle();
    const balance = data?.balance ?? 0;
    setCredits(balance);
    return balance;
  }, []);

  // Restore an existing Supabase session (persisted in AsyncStorage) on
  // launch, so users don't have to sign in again every time they reopen
  // the app — this is also what makes the free-credit dedup meaningful,
  // since there's no longer a "sign in again" step to accidentally re-grant it from.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id ?? null;
      setAppleUserId(userId);
      if (userId) {
        fetchCredits(userId);
        linkPurchasesIdentity(userId);
      }
    });
  }, [fetchCredits]);

  const completeOnboarding = useCallback(() => setHasSeenOnboarding(true), []);

  const pickPhoto = useCallback((uri: string, width: number, height: number) => {
    setPhotoUri(uri);
    setPhotoWidth(width);
    setPhotoHeight(height);
    setTapPoints([]);
    setAnyAccepted(false);
    setDogDetected(null);
    setCoverageComplete(false);
    setContinueAtNorm([]);
    setRemovalResult(null);
  }, []);

  const refreshPreview = useCallback(
    async (points: TapPoint[]) => {
      if (!photoUri || points.length === 0) {
        setAnyAccepted(false);
        setDogDetected(null);
        setCoverageComplete(false);
        setContinueAtNorm([]);
        return;
      }
      setIsPreviewLoading(true);
      try {
        const response = await previewLeashTaps(
          { uri: photoUri },
          toPixelPoints(points, photoWidth, photoHeight),
        );
        setTapPoints((current) =>
          current.map((point) => {
            const index = points.findIndex((p) => p.id === point.id);
            const preview = index === -1 ? undefined : response.previews[index];
            if (!preview) return point;
            return {
              ...point,
              status: preview.accepted ? 'accepted' : 'rejected',
              reason: preview.reason,
            };
          }),
        );
        setAnyAccepted(response.any_accepted);
        setDogDetected(response.dog_detected);
        setCoverageComplete(response.coverage_complete);
        setContinueAtNorm(
          response.continue_at.map((p) => ({ x: p.x / photoWidth, y: p.y / photoHeight })),
        );
      } catch (error) {
        console.warn('previewLeashTaps failed', error);
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [photoUri, photoWidth, photoHeight],
  );

  // Re-preview whenever the set of tap points changes (add or remove) — not
  // when their status changes, which this same effect just caused. Keying
  // on the joined ids rather than the array itself is what keeps that from
  // looping.
  const tapIdsKey = tapPoints.map((p) => p.id).join(',');
  useEffect(() => {
    // Syncs the tap set to the server (an external system) — the eventual
    // setState happens after the network round trip, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPreview(tapPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapIdsKey]);

  const addTapAt = useCallback((xNorm: number, yNorm: number) => {
    setTapPoints((current) => {
      if (current.length >= MAX_TAP_POINTS) return current;
      return [
        ...current,
        {
          id: `tap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          xNorm,
          yNorm,
          status: 'pending',
          reason: null,
        },
      ];
    });
  }, []);

  const removeTap = useCallback((id: string) => {
    setTapPoints((current) => current.filter((point) => point.id !== id));
  }, []);

  const runRemoval = useCallback(async () => {
    if (!photoUri) return false;
    setIsRemoving(true);
    try {
      const accepted = tapPoints.filter((point) => point.status === 'accepted');
      const result = await renderLeashRemoval(
        { uri: photoUri },
        toPixelPoints(accepted, photoWidth, photoHeight),
        { export: 'standard', lossless: false },
      );
      if (!result.succeeded) return false;
      setRemovalResult({ imageBase64: result.image, contentType: result.content_type });
      return true;
    } catch (error) {
      console.warn('renderLeashRemoval (standard) failed', error);
      return false;
    } finally {
      setIsRemoving(false);
    }
  }, [photoUri, photoWidth, photoHeight, tapPoints]);

  const runPrintRender = useCallback(async (): Promise<RemovalResult | null> => {
    if (!photoUri) return null;
    try {
      const accepted = tapPoints.filter((point) => point.status === 'accepted');
      const result = await renderLeashRemoval(
        { uri: photoUri },
        toPixelPoints(accepted, photoWidth, photoHeight),
        { export: 'print', lossless: false },
      );
      if (!result.succeeded) return null;
      return { imageBase64: result.image, contentType: result.content_type };
    } catch (error) {
      console.warn('renderLeashRemoval (print) failed', error);
      return null;
    }
  }, [photoUri, photoWidth, photoHeight, tapPoints]);

  const signIn = useCallback(async (identityToken: string, rawNonce: string) => {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,
    });
    if (error || !data.user) throw error ?? new Error('Sign in with Apple returned no user');

    setAppleUserId(data.user.id);
    await linkPurchasesIdentity(data.user.id);
    const { data: balance } = await supabase.rpc('claim_free_credit');
    setCredits(balance ?? 0);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await unlinkPurchasesIdentity();
    setAppleUserId(null);
    setCredits(0);
  }, []);

  const consumeCredit = useCallback(async () => {
    const { data } = await supabase.rpc('consume_credit');
    if (data === null || data === undefined) return false;
    setCredits(data);
    return true;
  }, []);

  // Purchased credits are granted server-side by the revenuecat-webhook Edge
  // Function once RevenueCat confirms the purchase — the client never tells
  // the server how many credits to add. This just re-reads the balance after
  // a purchase completes (the webhook may land a moment after the App Store
  // sheet closes, so callers should retry a few times).
  const refreshCredits = useCallback(async () => {
    if (!appleUserId) return credits;
    return fetchCredits(appleUserId);
  }, [appleUserId, fetchCredits, credits]);

  const resetFlow = useCallback(() => {
    setPhotoUri(null);
    setPhotoWidth(0);
    setPhotoHeight(0);
    setTapPoints([]);
    setAnyAccepted(false);
    setDogDetected(null);
    setCoverageComplete(false);
    setContinueAtNorm([]);
    setRemovalResult(null);
  }, []);

  const value = useMemo<FlowState>(
    () => ({
      hasSeenOnboarding,
      completeOnboarding,
      photoUri,
      photoWidth,
      photoHeight,
      pickPhoto,
      tapPoints,
      addTapAt,
      removeTap,
      isPreviewLoading,
      anyAccepted,
      dogDetected,
      coverageComplete,
      continueAtNorm,
      isRemoving,
      removalResult,
      runRemoval,
      runPrintRender,
      appleUserId,
      isSignedIn: appleUserId !== null,
      signIn,
      signOut,
      credits,
      consumeCredit,
      refreshCredits,
      resetFlow,
    }),
    [
      hasSeenOnboarding,
      completeOnboarding,
      photoUri,
      photoWidth,
      photoHeight,
      pickPhoto,
      tapPoints,
      addTapAt,
      removeTap,
      isPreviewLoading,
      anyAccepted,
      dogDetected,
      coverageComplete,
      continueAtNorm,
      isRemoving,
      removalResult,
      runRemoval,
      runPrintRender,
      appleUserId,
      signIn,
      signOut,
      credits,
      consumeCredit,
      refreshCredits,
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
