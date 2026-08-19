// Client for the leash-remover-api service (separate repo: leash-remover-api,
// see docs/api.md there). The photo is uploaded fresh to every call — the
// server holds nothing between requests, so there is no session id to keep.
//
// LEASH_SHARED_SECRET is a temporary "identifies the app, not the user"
// credential (see that repo's docs/auth.md) — it's meant to be replaced by a
// Supabase JWT before v1.0. Until then it's read the same way the RevenueCat
// key is: EXPO_PUBLIC_ values are readable in the bundle either way, so this
// isn't treated as a real secret.

import { File } from 'expo-file-system';

const apiUrl = process.env.EXPO_PUBLIC_LEASH_API_URL;
const sharedSecret = process.env.EXPO_PUBLIC_LEASH_SHARED_SECRET;

let warnedMissingConfig = false;

export function isLeashApiConfigured() {
  return Boolean(apiUrl);
}

function requireApiUrl() {
  if (!apiUrl) {
    if (!warnedMissingConfig) {
      console.warn(
        'Missing EXPO_PUBLIC_LEASH_API_URL — the leash-removal API is not configured. Add it (and EXPO_PUBLIC_LEASH_SHARED_SECRET) to .env.',
      );
      warnedMissingConfig = true;
    }
    throw new Error('Leash removal API is not configured');
  }
  return apiUrl;
}

function authHeaders(): HeadersInit {
  return sharedSecret ? { Authorization: `Bearer ${sharedSecret}` } : {};
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
  await fetch(`${url}/v1/warm`, { method: 'POST', headers: authHeaders() });
}

/** Preview what removing the given tap points would do, before committing to a render. */
export async function previewLeashTaps(photo: PhotoInput, points: Point[]): Promise<TapsPreviewResponse> {
  const url = requireApiUrl();
  const form = new FormData();
  form.append('photo', photoFormPart(photo));
  form.append('points', JSON.stringify(points));

  const response = await fetch(`${url}/v1/taps`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(`leash-api /v1/taps failed: ${response.status}`);
  }
  return response.json();
}

/** Remove the leash at the given points and return the rendered result. */
export async function renderLeashRemoval(
  photo: PhotoInput,
  points: Point[],
  options: { export: RenderExport; lossless?: boolean },
): Promise<RenderResult> {
  const url = requireApiUrl();
  const form = new FormData();
  form.append('photo', photoFormPart(photo));
  form.append('points', JSON.stringify(points));
  form.append('export', options.export);
  form.append('lossless', options.lossless ? 'true' : 'false');

  const response = await fetch(`${url}/v1/render`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(`leash-api /v1/render failed: ${response.status}`);
  }
  return response.json();
}
