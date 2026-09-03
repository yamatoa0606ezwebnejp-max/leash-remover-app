import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Crypto from 'expo-crypto';

import {
  previewLeashTaps,
  renderLeashRemoval,
  InsufficientCreditsError,
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
  creditBalance?: number;
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
  // Set when the last /v2/taps call itself failed (network/cold-start/5xx),
  // as opposed to a tap being scored and rejected by the server. Cleared at
  // the start of the next attempt. See refreshPreview below.
  previewError: string | null;
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
  // confirmed available. /v2/render (export=print) charges atomically
  // server-side — it either returns the image and charges once, or does
  // neither — so there's no separate client-side consume step; the caller
  // just reads RemovalResult.creditBalance for the post-charge balance.
  // Throws InsufficientCreditsError (leash-api.ts) on the server's 402.
  runPrintRender: () => Promise<RemovalResult | null>;

  // Sign in with Apple identity, gating print credits. Purpose: (1) prevent
  // free-credit reuse via reinstall, (2) prevent loss of paid consumable
  // credits on reinstall (Apple's Restore Purchases can't recover them).
  //
  // Identity + credits are persisted via Supabase (session in the Keychain
  // via expo-secure-store — see src/lib/secure-storage.ts — balance in
  // Postgres, see supabase/schema.sql), not local state, so
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
  // App Store Review Guideline 5.1.1(v): deletes the account server-side
  // (supabase/functions/delete-account) and its credits/purchase history
  // with it, then drops back into a fresh anonymous session, same as
  // signOut. Throws on failure — the caller (settings.tsx) is responsible
  // for surfacing that to the user rather than silently no-op'ing.
  deleteAccount: () => Promise<void>;

  credits: number;
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
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [anyAccepted, setAnyAccepted] = useState(false);
  const [dogDetected, setDogDetected] = useState<boolean | null>(null);
  const [coverageComplete, setCoverageComplete] = useState(false);
  const [continueAtNorm, setContinueAtNorm] = useState<{ x: number; y: number }[]>([]);

  const [isRemoving, setIsRemoving] = useState(false);
  const [removalResult, setRemovalResult] = useState<RemovalResult | null>(null);

  const [appleUserId, setAppleUserId] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [credits, setCredits] = useState(0);

  // The request_id for the print export currently in flight/last-failed —
  // stable across a manual retry of the *same* attempt (renderLeashRemoval
  // requires the caller to supply one precisely so it can stay stable here),
  // cleared once that attempt succeeds or the user moves to a different
  // photo. A ref, not state: it must not survive across export attempts by
  // accident, but changing it should never itself trigger a re-render.
  const printRequestIdRef = useRef<string | null>(null);

  const fetchCredits = useCallback(async (userId: string) => {
    const { data } = await supabase.from('credits').select('balance').eq('user_id', userId).maybeSingle();
    const balance = data?.balance ?? 0;
    setCredits(balance);
    return balance;
  }, []);

  // Restore an existing Supabase session (persisted in the Keychain) on
  // launch, so users don't have to sign in again every time they reopen
  // the app — this is also what makes the free-credit dedup meaningful,
  // since there's no longer a "sign in again" step to accidentally re-grant it from.
  //
  // /v2 of leash-remover-api requires a Supabase JWT on every call, including
  // the free flow (taps, standard render), so every launch needs a session —
  // anonymous if there's no real one yet. Sign in with Apple later upgrades
  // this same session via linkIdentity() rather than starting a new one (see
  // signIn below), which is what keeps free-flow usage working without a
  // sign-in wall (App Store Review Guideline 5.1.1(v)).
  useEffect(() => {
    async function bootstrap() {
      const { data } = await supabase.auth.getSession();
      let session = data.session;
      if (!session) {
        const { data: anon, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.warn('signInAnonymously failed', error);
          return;
        }
        session = anon.session;
      }
      const user = session?.user ?? null;
      setAppleUserId(user?.id ?? null);
      setIsAnonymous(user?.is_anonymous ?? true);
      if (user && !user.is_anonymous) {
        fetchCredits(user.id);
        linkPurchasesIdentity(user.id);
      }
    }
    bootstrap();
  }, [fetchCredits]);

  const completeOnboarding = useCallback(() => setHasSeenOnboarding(true), []);

  const pickPhoto = useCallback((uri: string, width: number, height: number) => {
    printRequestIdRef.current = null;
    setPhotoUri(uri);
    setPhotoWidth(width);
    setPhotoHeight(height);
    setTapPoints([]);
    setAnyAccepted(false);
    setDogDetected(null);
    setCoverageComplete(false);
    setContinueAtNorm([]);
    setPreviewError(null);
    setRemovalResult(null);
  }, []);

  const refreshPreview = useCallback(
    async (points: TapPoint[]) => {
      if (!photoUri || points.length === 0) {
        setAnyAccepted(false);
        setDogDetected(null);
        setCoverageComplete(false);
        setContinueAtNorm([]);
        setPreviewError(null);
        return;
      }
      setIsPreviewLoading(true);
      setPreviewError(null);
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
        // Without this, a failed request leaves this attempt's taps stuck in
        // 'pending' forever (spinner never resolves) and anyAccepted never
        // flips true, so "Remove Leash" stays disabled with no explanation —
        // reported via TestFlight as the tap screen "not progressing".
        setPreviewError('Could not check that tap. Remove it and try again.');
        setTapPoints((current) =>
          current.map((point) =>
            point.status === 'pending' && points.some((p) => p.id === point.id)
              ? { ...point, status: 'rejected', reason: null }
              : point,
          ),
        );
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
    // Reuse the in-flight/last-failed attempt's id if there is one, so a
    // manual retry (the user tapping "Export" again after a lost response)
    // charges at most once — see leash-api.ts's renderLeashRemoval. Only
    // cleared below on confirmed success, or in pickPhoto/resetFlow.
    if (!printRequestIdRef.current) {
      printRequestIdRef.current = Crypto.randomUUID();
    }
    try {
      const accepted = tapPoints.filter((point) => point.status === 'accepted');
      const result = await renderLeashRemoval(
        { uri: photoUri },
        toPixelPoints(accepted, photoWidth, photoHeight),
        { export: 'print', lossless: false, requestId: printRequestIdRef.current },
      );
      if (!result.succeeded) return null;
      printRequestIdRef.current = null;
      // The server sends credit_balance as null (not an omitted key) on a
      // non-print render — verified against the deployed /v2 — so guard
      // with typeof rather than a null/undefined check.
      if (typeof result.credit_balance === 'number') setCredits(result.credit_balance);
      return {
        imageBase64: result.image,
        contentType: result.content_type,
        creditBalance: result.credit_balance ?? undefined,
      };
    } catch (error) {
      // Let the caller (export.tsx) send the user to the purchase screen on
      // a 402 rather than showing it as a generic render failure. No charge
      // happened either way, so printRequestIdRef is left as-is — reusing it
      // on a subsequent attempt is still correct, just unnecessary.
      if (error instanceof InsufficientCreditsError) throw error;
      console.warn('renderLeashRemoval (print) failed', error);
      return null;
    }
  }, [photoUri, photoWidth, photoHeight, tapPoints]);

  const signIn = useCallback(async (identityToken: string, rawNonce: string) => {
    // linkIdentity() first — the app is already signed in anonymously (see
    // bootstrap above), and this upgrades that same session/uid rather than
    // creating a second user. But this Apple identity may already be linked
    // to a *different*, pre-existing user (a real reinstall, or — as found
    // testing TODO 142 — the same Apple ID used before /v2 existed): Supabase
    // then refuses the link with 422 identity_already_exists. In that case
    // fall back to signInWithIdToken(), which signs into that existing
    // account instead — the anonymous session is discarded, but that's
    // correct: the existing account is the one with the user's real credit
    // balance, and reinstall recovery is the whole point of this flow.
    let { data, error } = await supabase.auth.linkIdentity({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,
    });

    if (error?.code === 'identity_already_exists') {
      ({ data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
        nonce: rawNonce,
      }));
    }
    if (error || !data.user) throw error ?? new Error('Sign in with Apple returned no user');

    setAppleUserId(data.user.id);
    setIsAnonymous(false);
    await linkPurchasesIdentity(data.user.id);
    const { data: balance } = await supabase.rpc('claim_free_credit');
    setCredits(balance ?? 0);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await unlinkPurchasesIdentity();
    setCredits(0);
    // /v2 needs a session for every call, including the free flow, so drop
    // straight back into an anonymous one rather than leaving no session.
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn('signInAnonymously (post sign-out) failed', error);
      setAppleUserId(null);
      setIsAnonymous(true);
      return;
    }
    setAppleUserId(data.user?.id ?? null);
    setIsAnonymous(true);
  }, []);

  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw error;

    await unlinkPurchasesIdentity();
    setCredits(0);
    // The account is already gone server-side, so there's nothing left to
    // sign out of remotely — just clear the now-stale local session, then
    // drop back into a fresh anonymous one, same as signOut.
    await supabase.auth.signOut({ scope: 'local' });
    const { data, error: anonError } = await supabase.auth.signInAnonymously();
    if (anonError) {
      console.warn('signInAnonymously (post delete) failed', anonError);
      setAppleUserId(null);
      setIsAnonymous(true);
      return;
    }
    setAppleUserId(data.user?.id ?? null);
    setIsAnonymous(true);
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
    printRequestIdRef.current = null;
    setPhotoUri(null);
    setPhotoWidth(0);
    setPhotoHeight(0);
    setTapPoints([]);
    setAnyAccepted(false);
    setDogDetected(null);
    setCoverageComplete(false);
    setContinueAtNorm([]);
    setPreviewError(null);
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
      previewError,
      anyAccepted,
      dogDetected,
      coverageComplete,
      continueAtNorm,
      isRemoving,
      removalResult,
      runRemoval,
      runPrintRender,
      appleUserId,
      isSignedIn: appleUserId !== null && !isAnonymous,
      signIn,
      signOut,
      deleteAccount,
      credits,
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
      previewError,
      anyAccepted,
      dogDetected,
      coverageComplete,
      continueAtNorm,
      isRemoving,
      removalResult,
      runRemoval,
      runPrintRender,
      appleUserId,
      isAnonymous,
      signIn,
      signOut,
      deleteAccount,
      credits,
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
