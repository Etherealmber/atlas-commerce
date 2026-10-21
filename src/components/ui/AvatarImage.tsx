import { useEffect, useRef, type FC } from 'react';
import { getAvatarUrl, sanitizeAvatarUrl } from '../../auth';

type Props = {
  className?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
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
export const AvatarImage: FC<Props> = ({ className, width, height, loading }) => {
  const ref = useRef<HTMLImageElement | null>(null);
  // In-memory read (no DOM storage): cheap, and the value only ever reaches
  // the DOM through an opaque object URL below.
  const url = sanitizeAvatarUrl(getAvatarUrl());

  useEffect(() => {
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
        const r = await fetch(url);
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
        if (!cancelled) el.removeAttribute('src');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <img
      ref={ref}
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
