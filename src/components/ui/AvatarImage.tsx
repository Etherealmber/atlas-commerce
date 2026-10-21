import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { getAvatarUrl, sanitizeAvatarUrl } from '../../auth';
import { avatarObjectUrl, peekAvatarObjectUrl } from '../../lib/avatarCache';

type Props = {
  className?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  /** Rendered instead of a blank frame while loading or when the fetch fails. */
  fallback?: ReactNode;
};

/**
 * Profile avatar image — fast path (v243):
 *  1. one shared fetch per session (module blob cache, deduped in-flight);
 *  2. the worker serves it from a Durable-Object blob cache / edge cache;
 *  3. until the blob is warm the fallback (initials/monogram) shows, so the
 *     UI never waits on a blank circle;
 *  4. src is assigned imperatively from an opaque object URL (CodeQL-safe).
 */
export const AvatarImage: FC<Props> = ({ className, width, height, loading, fallback }) => {
  const ref = useRef<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string>(() => sanitizeAvatarUrl(getAvatarUrl()));
  const [objectUrl, setObjectUrl] = useState<string | null>(() => (url ? peekAvatarObjectUrl(url) : null));
  const [failed, setFailed] = useState(false);

  // React to the profile cache landing after a refresh (or an avatar change):
  // re-read the url so the image appears without any user interaction.
  useEffect(() => {
    const sync = () => {
      setFailed(false);
      setUrl(sanitizeAvatarUrl(getAvatarUrl()));
    };
    window.addEventListener('atlas-profile-changed', sync);
    window.addEventListener('atlas-avatar-changed', sync);
    return () => {
      window.removeEventListener('atlas-profile-changed', sync);
      window.removeEventListener('atlas-avatar-changed', sync);
    };
  }, []);

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
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const el = ref.current;
    if (el && objectUrl) el.src = objectUrl;
  }, [objectUrl]);

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
      onError={() => setFailed(true)}
    />
  );
};

export default AvatarImage;
