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
 * The cached avatar URL (localStorage, validated by the strict whitelist in
 * auth.ts: http/https + known image extension, or a safe data: image) is
 * never interpolated into markup. It is assigned to the `src` *property* of
 * the <img> element inside an effect — a URL context that the browser never
 * re-parses as HTML — instead of being inlined as a JSX attribute value.
 */
export const AvatarImage: FC<Props> = ({ className, width, height, loading }) => {
  const ref = useRef<HTMLImageElement | null>(null);

  // Re-read the cached avatar after every render (same freshness as the
  // previous inline read, but the URL text never enters markup).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Whitelist barrier at the sink: only validated http(s)/data image URLs.
    const url = sanitizeAvatarUrl(getAvatarUrl());
    if (url) el.src = url;
    else el.removeAttribute('src');
  });

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
