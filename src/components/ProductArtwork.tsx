import { useEffect, useRef, useState } from 'react';
import { Package } from 'lucide-react';
import { getApiBase } from '../config';
import { api } from '../api';

/** Accept only image data and HTTP(S) references; relative URLs use the API origin on native shells. */
export function productImageUrl(raw: unknown, base = getApiBase()): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\s<>"'`]/.test(value)) return `${base}${value}`;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { /* invalid image reference */ }
  return '';
}

type Props = { url?: unknown; className?: string; largeImageProductId?: number };
export default function ProductArtwork({ url, className = '', largeImageProductId }: Props) {
  const [deferredUrl, setDeferredUrl] = useState(''); const [failed, setFailed] = useState(false); const ref = useRef<HTMLSpanElement>(null);
  const src = productImageUrl(url || deferredUrl);
  useEffect(() => setFailed(false), [src]);
  useEffect(() => {
    setDeferredUrl('');
    if (url || !largeImageProductId || !ref.current) return;
    let active = true; let started = false; let observer: IntersectionObserver | undefined;
    const load = () => {
      if (started) return; started = true; observer?.disconnect();
      void api.getProduct(largeImageProductId).then(response => { if (active && typeof response.data?.image_url === 'string') setDeferredUrl(response.data.image_url); }).catch(() => { /* show fallback if offline */ });
    };
    if (typeof IntersectionObserver === 'undefined') load();
    else { observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load(); }, { rootMargin: '200px' }); observer.observe(ref.current); }
    return () => { active = false; observer?.disconnect(); };
  }, [url, largeImageProductId]);
  return <span ref={ref} className={`product-artwork ${className}`}>{src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Package size={24} aria-hidden="true" />}</span>;
}
