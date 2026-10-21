import { useEffect } from 'react';
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

export default useProfileWarm;
