import { getAvatarUrl, getToken } from '../auth';

/**
 * Shared in-memory avatar blob cache (v243).
 *
 * Every AvatarImage instance (topbar, user menu, sidebar, settings, phone
 * shell) resolves the avatar through ONE fetch per session: the first caller
 * fetches + converts to an object URL, everybody else reuses it instantly.
 * Object URLs are never persisted (session-only), same rule as before.
 */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function fetchAvatarBlob(url: string): Promise<string> {
  const crossOrigin = /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin);
  const fetchUrl = crossOrigin ? '/api/me/avatar' : url;
  const token = crossOrigin ? getToken() : null;
  return fetch(fetchUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
    .then((r) => {
      if (!r.ok) throw new Error(`http ${r.status}`);
      return r.blob();
    })
    .then((blob) => URL.createObjectURL(blob));
}

/** Resolve an opaque object URL for the avatar, shared + deduped. */
export function avatarObjectUrl(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(url);
  if (running) return running;
  const p = fetchAvatarBlob(url)
    .then((objectUrl) => {
      cache.set(url, objectUrl);
      inflight.delete(url);
      return objectUrl;
    })
    .catch((e) => {
      inflight.delete(url);
      throw e;
    });
  inflight.set(url, p);
  return p;
}

/** Synchronous peek — renders instantly when the blob is already warm. */
export function peekAvatarObjectUrl(url: string): string | null {
  return cache.get(url) || null;
}

/** Fire-and-forget warm-up (called as soon as the profile cache lands). */
export function prefetchAvatar(url?: string | null): void {
  const u = String(url || '').trim();
  if (!u) return;
  void avatarObjectUrl(u).catch(() => { /* initials fallback stays */ });
}

/** Drop everything (logout or avatar re-upload). */
export function invalidateAvatarCache(): void {
  for (const objectUrl of cache.values()) {
    try { URL.revokeObjectURL(objectUrl); } catch { /* */ }
  }
  cache.clear();
  inflight.clear();
}

// React to profile/avatar changes: drop stale blobs, prefetch the fresh one.
if (typeof window !== 'undefined') {
  window.addEventListener('atlas-avatar-changed', () => {
    invalidateAvatarCache();
    prefetchAvatar(getAvatarUrl());
  });
}
