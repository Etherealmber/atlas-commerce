import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { getAvatarUrl, sanitizeAvatarUrl } from '../../auth';
import { avatarObjectUrl, dropAvatar, peekAvatarObjectUrl } from '../../lib/avatarCache';

type Props = {
  className?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  /** Rendered instead of a blank frame while loading or when the fetch fails. */
  fallback?: ReactNode;
};

/**
 * Profile avatar image — fast path (v243, v0.9.3):
 *  1. one shared fetch per session (module blob cache, deduped in-flight);
 *  2. the worker serves it from a Durable-Object blob cache / edge cache;
 *  3. until the blob is warm the fallback (initials/monogram) shows, so the
 *     UI never waits on a blank circle;
 *  4. src is assigned imperatively from an opaque object URL (CodeQL-safe);
 *  5. loads eagerly, and a failed fetch / decode is retried once before the
 *     fallback, so a slow or broken first load heals by itself.
 */
export const AvatarImage: FC<Props> = ({ className, width, height, loading = 'eager', fallback }) => {
  const ref = useRef<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string>(() => sanitizeAvatarUrl(getAvatarUrl()));
  const [objectUrl, setObjectUrl] = useState<string | null>(() => (url ? peekAvatarObjectUrl(url) : null));
  const [failed, setFailed] = useState(false);
  /** Bumped to force a fresh fetch of the same url (decode error, profile refresh after a failure). */
  const [attempt, setAttempt] = useState(0);
  const retried = useRef(false);
  const failedRef = useRef(false);

  useEffect(() => {
    failedRef.current = failed;
  }, [failed]);

  // React to the profile cache landing after a refresh (or an avatar change):
  // re-read the url so the image appears without any user interaction. When the
  // url is unchanged but the last load failed, try again instead of staying blank.
  useEffect(() => {
    const sync = () => {
      const next = sanitizeAvatarUrl(getAvatarUrl());
      setUrl(next);
      if (failedRef.current) {
        retried.current = false;
        setAttempt((n) => n + 1);
      }
    };
    window.addEventListener('atlas-profile-changed', sync);
    window.addEventListener('atlas-avatar-changed', sync);
    return () => {
      window.removeEventListener('atlas-profile-changed', sync);
      window.removeEventListener('atlas-avatar-changed', sync);
    };
  }, []);

  // A new url gets its own silent retry.
  useEffect(() => {
    retried.current = false;
  }, [url]);

  useEffect(() => {
    setFailed(false);
    if (!url) {
      setObjectUrl(null);
      return;
    }
    const peek = peekAvatarObjectUrl(url);
    if (peek) {
      setObjectUrl(peek);
      return;
    }
    let cancelled = false;
    avatarObjectUrl(url)
      .then((o) => {
        if (!cancelled) setObjectUrl(o);
      })
      .catch(() => {
        if (cancelled) return;
        // One silent retry (network blip, cold edge cache) before the fallback.
        if (!retried.current) {
          retried.current = true;
          setAttempt((n) => n + 1);
        } else {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, attempt]);

  useEffect(() => {
    const el = ref.current;
    if (el && objectUrl && el.src !== objectUrl) el.src = objectUrl;
  }, [objectUrl, failed]);

  const onError = () => {
    // The blob behind this object URL is gone (revoked or corrupt): refetch once.
    if (url && !retried.current) {
      retried.current = true;
      dropAvatar(url);
      setObjectUrl(null);
      setAttempt((n) => n + 1);
      return;
    }
    setFailed(true);
  };

  if (!url || failed || !objectUrl) return <>{fallback ?? null}</>;

  return (
    <img
      ref={ref}
      className={className}
      alt=""
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      onError={onError}
    />
  );
};
