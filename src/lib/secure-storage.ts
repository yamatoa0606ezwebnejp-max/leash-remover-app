// A Supabase-compatible storage adapter backed by expo-secure-store (the iOS
// Keychain / Android Keystore), instead of AsyncStorage's plaintext file —
// see docs/security-design-2026-08-25.md (leash-remover-api, private repo)
// C-1: the Supabase session, including its refresh token, was previously
// readable in plaintext on a jailbroken or backed-up device.
//
// SecureStore rejects values above roughly 2048 bytes on iOS (undocumented,
// platform-imposed), and a Supabase session — access + refresh token, user
// metadata — routinely exceeds that. This adapter splits a value across
// numbered chunk keys and a small manifest key recording the chunk count.

import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800; // margin under the ~2048B ceiling for key-name overhead

function chunkKey(key: string, index: number) {
  return `${key}_${index}`;
}

function manifestKey(key: string) {
  return `${key}_chunks`;
}

async function getChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  return raw ? parseInt(raw, 10) : 0;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await getChunkCount(key);
    if (count === 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i))),
    );
    if (parts.some((part) => part === null)) return null; // partial write, treat as absent
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await getChunkCount(key);
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk)));
    // A shorter value than last time leaves stale chunks past the new count.
    await Promise.all(
      Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_, i) =>
        SecureStore.deleteItemAsync(chunkKey(key, chunks.length + i)),
      ),
    );
    await SecureStore.setItemAsync(manifestKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const count = await getChunkCount(key);
    await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))));
    await SecureStore.deleteItemAsync(manifestKey(key));
  },
};
