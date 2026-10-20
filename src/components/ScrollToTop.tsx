import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Reset window + main content scroll on every route change
 * so navigating away from a scrolled page does not leave the next page mid-scroll.
 */
export default function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // In-page anchors: let the browser handle hash targets
    if (hash && hash.length > 1) {
      const id = hash.slice(1);
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        return;
      }
    }

    const reset = () => {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch {
        window.scrollTo(0, 0);
      }
      // Primary app shell scroll container
      const main = document.querySelector('main.content') as HTMLElement | null;
      if (main) {
        main.scrollTop = 0;
        main.scrollLeft = 0;
      }
      // Any nested page scroll containers used across modules
      document.querySelectorAll<HTMLElement>(
        '.atlas-page, .content-scroll, .phone-scroll, .settings-main, .mailbox-pane, .table-wrap',
      ).forEach((node) => {
        // Only reset elements that actually scroll (avoid resetting table inner if user expects keep — still safer to top on route change)
        if (node.scrollTop || node.scrollLeft) {
          node.scrollTop = 0;
          node.scrollLeft = 0;
        }
      });
      // DocumentElement / body for overflow on html
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };

    reset();
    // After layout (lazy routes / images)
    requestAnimationFrame(reset);
    const t = window.setTimeout(reset, 50);
    return () => window.clearTimeout(t);
  }, [pathname, search, hash]);

  return null;
}
