import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { getAvatarUrl, sanitizeAvatarUrl, getToken } from '../../auth';

type Props = {
  className?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  /** Rendered instead of a blank frame when no URL or the fetch fails. */
  fallback?: ReactNode;
};

/**
 * Profile avatar image.
 *
 * Defence in depth, in order:
 *  1. the cached URL passes the strict whitelist (http/https + image ext,
 *     or plain base64 data: image);
 *  2. it is fetched and rendered through an opaque object URL, so NO
 *     stored / DOM-derived / canvas-derived string is ever assigned to
 *     the `src` property or interpolated into markup (kills every
 *     DOM-text -> HTML-sink taint path, CodeQL js/dom-text-reinterpreted-as-html).
 */
export const AvatarImage: FC<Props> = ({ className, width, height, loading, fallback }) => {
  const ref = useRef<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  // In-memory read (no DOM storage): cheap, and the value only ever reaches
  // the DOM through an opaque object URL below.
  const url = sanitizeAvatarUrl(getAvatarUrl());

  useEffect(() => {
    setFailed(false);
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let objectUrl = '';
    if (!url) {
      el.removeAttribute('src');
      return;
    }
    (async () => {
      try {
        // Cross-origin avatar CDNs (no CORS headers) are fetched through the
        // same-origin worker proxy; everything else is fetched directly.
        const crossOrigin = /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin);
        const fetchUrl = crossOrigin ? '/api/me/avatar' : url;
        const token = crossOrigin ? getToken() : null;
        const r = await fetch(fetchUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
        if (!r.ok) throw new Error(`http ${r.status}`);
        const blob = await r.blob();
        const o = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(o);
          return;
        }
        objectUrl = o;
        el.src = o;
      } catch {
        if (!cancelled) {
          el.removeAttribute('src');
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url || failed) return <>{fallback ?? null}</>;

  return (
    <img
      ref={ref}
      onError={() => setFailed(true)}
      className={className}
      alt=""
      width={width}
      height={height}
      loading={loading}
      decoding="async"
    />
  );
};

export default AvatarImage;
