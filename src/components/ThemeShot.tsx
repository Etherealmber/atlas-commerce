import { useLang } from '../i18n/core';
/**
 * A real app screenshot in both themes: the light capture shows in light mode,
 * the dark capture in dark mode (driven by `html[data-theme]`, no JS).
 * Images live in public/shots (see scripts/make-site-shots.mjs).
 */
export default function ThemeShot({ name, alt, width, height, className = '', eager = false }: {
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  eager?: boolean;
}) {
  const loading = eager ? 'eager' : 'lazy';
  const lang = useLang();
  const suffix = name === 'site-dashboard' && lang !== 'fr' ? `-${lang}` : '';
  return <span className={`theme-shot ${className}`.trim()}>
    <img className="theme-shot-img theme-shot-img--light" src={`/shots/${name}${suffix}-light.webp`} alt={alt} width={width} height={height} loading={loading} decoding="async" />
    <img className="theme-shot-img theme-shot-img--dark" src={`/shots/${name}${suffix}-dark.webp`} alt="" aria-hidden="true" width={width} height={height} loading={loading} decoding="async" />
  </span>;
}
