// Client for the leash-remover-api service (separate repo: leash-remover-api,
// see docs/api.md there, "/v2 — the same three routes with a person
// attached"). The photo is uploaded fresh to every call — the server holds
// nothing between requests, so there is no session id to keep.
//
// /v2 authenticates with the caller's own Supabase access token rather than
// the old LEASH_SHARED_SECRET (an "identifies the app, not the user"
// placeholder — see that repo's docs/auth.md). The app is always signed in
// by the time this is called, anonymously at minimum (see the bootstrap
// effect in flow-context.tsx), so a session should always be present.

import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

const apiUrl = process.env.EXPO_PUBLIC_LEASH_API_URL;

let warnedMissingConfig = false;

export function isLeashApiConfigured() {
  return Boolean(apiUrl);
}

function requireApiUrl() {
  if (!apiUrl) {
    if (!warnedMissingConfig) {
      console.warn(
        'Missing EXPO_PUBLIC_LEASH_API_URL — the leash-removal API is not configured. Add it to .env.',
      );
      warnedMissingConfig = true;
    }
    throw new Error('Leash removal API is not configured');
  }
  return apiUrl;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Thrown for /v2/render export=print's 402: no credit, send the user to purchase. */
export class InsufficientCreditsError extends Error {
  constructor() {
    super('No print credit available');
  }
}

export type Point = { x: number; y: number };

export type TapPreview = {
  accepted: boolean;
  reason: 'no_mask' | 'too_large' | 'grabbed_dog' | 'grabbed_person' | null;
  area_fraction: number;
  aspect_ratio: number;
  mask_png?: string; // base64, present only when accepted
};

export type TapsPreviewResponse = {
  previews: TapPreview[];
  any_accepted: boolean;
  dog_detected: boolean;
  coverage_complete: boolean;
  continue_at: Point[];
};

export type RenderExport = 'standard' | 'print';

export type RenderResult =
  | {
      succeeded: true;
      image: string; // base64
      content_type: string;
      inpainter: string;
      elapsed_ms: Record<string, number>;
      coverage_complete: boolean;
      continue_at: Point[];
      // Set only on a print export — what's left after this render's
      // charge. null (not zero) on a standard export, where nothing was
      // charged or looked up — the server sends the key with a null value
      // rather than omitting it, despite what docs/api.md says.
      credit_balance?: number | null;
    }
  | {
      succeeded: false;
      reason: TapPreview['reason'];
    };

type PhotoInput = {
  uri: string;
};

function photoFormPart({ uri }: PhotoInput) {
  // Expo SDK 57's global fetch (the "winter" WinterCG runtime) does not
  // accept React Native's classic { uri, name, type } file reference in a
  // FormData part — it requires a real Blob, and throws "Unsupported
  // FormDataPart implementation" otherwise. expo-file-system's File class
  // implements Blob (readableStream/arrayBuffer/bytes) and derives name and
  // mime type from the uri itself, so it satisfies both the runtime check
  // and the multipart headers.
  return new File(uri);
}

/** Call when the photo picker opens, to cover most of the ~34s cold start. */
export async function warmLeashApi(): Promise<void> {
  const url = requireApiUrl();
  // Rate-limited server-side (one per user per 5 min, else 429) — warm is
  // fire-and-forget, so a 429 here just means an instance is already warm.
  await fetch(`${url}/v2/warm`, { method: 'POST', headers: await authHeaders() });
}

/** Preview what removing the given tap points would do, before committing to a render. */
export async function previewLeashTaps(photo: PhotoInput, points: Point[]): Promise<TapsPreviewResponse> {
  const url = requireApiUrl();
  const form = new FormData();
  form.append('photo', photoFormPart(photo));
  form.append('points', JSON.stringify(points));

  const response = await fetch(`${url}/v2/taps`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(`leash-api /v2/taps failed: ${response.status}`);
  }
  return response.json();
}

/** Remove the leash at the given points and return the rendered result. */
export async function renderLeashRemoval(
  photo: PhotoInput,
  points: Point[],
  // requestId is required for a print export: it makes the server-side
  // charge idempotent, but only if the *caller* keeps it stable across a
  // manual retry of the same export attempt (e.g. the user tapping "Export"
  // again after a lost response) — see flow-context.tsx's runPrintRender,
  // which owns that lifetime. Generating a fresh id per call here would
  // silently defeat the whole point and risk double-charging a credit.
  options: { export: RenderExport; lossless?: boolean; requestId?: string },
): Promise<RenderResult> {
  const url = requireApiUrl();
  const form = new FormData();
  form.append('photo', photoFormPart(photo));
  form.append('points', JSON.stringify(points));
  form.append('export', options.export);
  form.append('lossless', options.lossless ? 'true' : 'false');
  if (options.export === 'print') {
    if (!options.requestId) throw new Error('renderLeashRemoval: requestId is required for export=print');
    form.append('request_id', options.requestId);
  }

  const response = await fetch(`${url}/v2/render`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  if (response.status === 402) {
    throw new InsufficientCreditsError();
  }
  if (!response.ok) {
    throw new Error(`leash-api /v2/render failed: ${response.status}`);
  }
  return response.json();
}
