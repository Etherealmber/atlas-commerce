import { useEffect, type RefObject } from 'react';

/** Progressive enhancement: content is visible before JS, without observers, and with reduced motion. */
export function useLandingMotion(rootRef: RefObject<HTMLElement | null>, selector: string, previewSelector: string) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const preview = root.querySelector<HTMLElement>(previewSelector);
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let observer: IntersectionObserver | undefined;
    let frame = 0;

    const showAll = () => targets.forEach((el) => { el.classList.remove('motion-pending'); el.classList.add('is-in'); });
    const draw = () => {
      frame = 0;
      if (!preview || motion?.matches) return;
      // Measure the untransformed parent to avoid a feedback loop as the preview settles.
      const bounds = preview.parentElement?.getBoundingClientRect();
      if (!bounds) return;
      const progress = Math.max(0, Math.min(1, (window.innerHeight - bounds.top) / (window.innerHeight * 0.65 + bounds.height * 0.35)));
      preview.style.setProperty('--atlas-preview-tilt', `${(4 * (1 - progress)).toFixed(2)}deg`);
      preview.style.setProperty('--atlas-preview-scale', (0.98 + 0.02 * progress).toFixed(3));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const onMotionChange = () => {
      if (motion?.matches) {
        observer?.disconnect();
        showAll();
        preview?.style.removeProperty('--atlas-preview-tilt');
        preview?.style.removeProperty('--atlas-preview-scale');
      } else onScroll();
    };

    if (motion?.matches || typeof IntersectionObserver === 'undefined') showAll();
    else {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            entry.target.classList.remove('motion-pending');
            observer?.unobserve(entry.target);
          }
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
      targets.forEach((el) => {
        // Never hide content already on screen or above it, including anchor targets.
        if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add('is-in');
        else { el.classList.add('motion-pending'); observer?.observe(el); }
      });
    }
    if (preview) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      onScroll();
    }
    motion?.addEventListener?.('change', onMotionChange);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      motion?.removeEventListener?.('change', onMotionChange);
      if (frame) cancelAnimationFrame(frame);
      targets.forEach((el) => el.classList.remove('motion-pending', 'is-in'));
      preview?.style.removeProperty('--atlas-preview-tilt');
      preview?.style.removeProperty('--atlas-preview-scale');
    };
  }, [rootRef, selector, previewSelector]);
}
