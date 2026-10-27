import { useEffect, useState } from 'react';
import { api } from '../api';
import { setProfileCache } from '../auth';
import { prefetchAvatar } from './avatarCache';

/**
 * Warm the in-memory profile cache (name, role, avatar) once at mount.
 * The avatar URL is no longer persisted in DOM storage, so shells fetch it
 * from the API on boot (best-effort; initials show until then).
 */
export function useProfileWarm(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getMe();
        const m = (r as any)?.data || r || {};
        if (cancelled) return;
        setProfileCache({
          display_name: m.display_name,
          avatar_url: m.avatar_url,
          username: m.username,
          role: m.role,
        });
        // Start the avatar blob fetch now so the topbar never waits on it.
        prefetchAvatar(m.avatar_url);
      } catch {
        /* best-effort: keep whatever the login flow cached */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * v0.7 — re-render the caller when the profile cache changes (avatar URL and
 * display name arrive asynchronously after a refresh). Without this the
 * topbar kept showing initials until some unrelated state (opening the menu)
 * forced a re-render.
 */
export function useProfileTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('atlas-profile-changed', bump);
    window.addEventListener('atlas-avatar-changed', bump);
    return () => {
      window.removeEventListener('atlas-profile-changed', bump);
      window.removeEventListener('atlas-avatar-changed', bump);
    };
  }, []);
  return tick;
}

export default useProfileWarm;
