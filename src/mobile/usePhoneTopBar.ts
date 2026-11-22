import { useCallback, useEffect, useRef, useState } from 'react';

/** Collapse for intentional content scrolling; ignore scrolls inside floating UI. */
export function usePhoneTopBar(pathname: string, onCollapse: () => void) {
  const [collapsed, setCollapsedState] = useState(false);
  const manualExpansionUntil = useRef(0);
  const setCollapsed = useCallback((value: boolean) => {
    // Layout changes and momentum events immediately after a tap must not undo it.
    if (!value) manualExpansionUntil.current = Date.now() + 400;
    setCollapsedState(value);
  }, []);
  useEffect(() => {
    setCollapsedState(false); manualExpansionUntil.current = 0;
    if (/^\/m\/products\/\d+\/historique$/.test(pathname) || pathname.startsWith('/m/settings/')) return;
    let lastWindow = window.scrollY; let distance = 0; const positions = new WeakMap<Element, number>();
    const onScroll = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('.phone-topbar, .ph-modal-bg, [role="dialog"]')) return;
      const current = element ? element.scrollTop : window.scrollY;
      const previous = element ? (positions.get(element) ?? 0) : lastWindow;
      if (element) positions.set(element, current); else lastWindow = current;
      if (element?.getAttribute('data-phone-programmatic-scroll') === 'true') { distance = 0; return; }
      if (Date.now() < manualExpansionUntil.current) { distance = 0; return; }
      const delta = current - previous;
      if (!delta) return;
      if ((distance > 0 && delta < 0) || (distance < 0 && delta > 0)) distance = 0;
      distance += delta;
      if (distance >= 12) { setCollapsedState(true); onCollapse(); distance = 0; }
      else if (distance <= -12) { setCollapsedState(false); distance = 0; }
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [pathname, onCollapse]);
  return [collapsed, setCollapsed] as const;
}
