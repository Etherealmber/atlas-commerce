import { useEffect, useState } from 'react';

/** Collapse after a small downward scroll and expand on upward scroll, like Android.
 * Capture scroll events from both the document and nested views such as Agent. */
export function usePhoneTopBar(pathname: string, onCollapse: () => void) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(false);
    if (/^\/m\/products\/\d+\/historique$/.test(pathname) || pathname.startsWith('/m/settings/')) return;
    let lastWindow = window.scrollY; let distance = 0; const positions = new WeakMap<Element, number>();
    const onScroll = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      const current = element ? element.scrollTop : window.scrollY;
      const previous = element ? (positions.get(element) ?? 0) : lastWindow;
      if (element) positions.set(element, current); else lastWindow = current;
      const delta = current - previous;
      if (!delta) return;
      if ((distance > 0 && delta < 0) || (distance < 0 && delta > 0)) distance = 0;
      distance += delta;
      if (distance >= 12) { setCollapsed(true); onCollapse(); distance = 0; }
      else if (distance <= -12) { setCollapsed(false); distance = 0; }
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [pathname, onCollapse]);
  return [collapsed, setCollapsed] as const;
}
