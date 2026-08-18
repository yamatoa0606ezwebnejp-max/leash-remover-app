import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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

/**
 * In-memory mock state for the photo → detect → correct → remove → export
 * flow. No real detection/removal — see screen-implementation-handoff.md
 * section 5 for what's explicitly out of scope (image processing API).
 *
 * Identity (appleUserId) and credits ARE persisted, via Supabase, and
 * purchased credits ARE verified, via RevenueCat + a webhook — see the
 * signIn/consumeCredit/refreshCredits comments below.
 */

export type Highlight = {
  id: string;
  left: number; // 0–1, fraction of the image container
  top: number;
  width: number;
  height: number;
  included: boolean;
};

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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [devForceDetectionFailure, setDevForceDetectionFailure] = useState(false);
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
      refreshCredits,
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
