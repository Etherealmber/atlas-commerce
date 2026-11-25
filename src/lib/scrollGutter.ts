/**
 * Keep the page from shifting sideways when a menu/drawer/modal locks scroll.
 *
 * Every scroll lock in the app (hamburger drawers, account menu, modals…)
 * sets `overflow: hidden` on <html>/<body>. On desktops with classic
 * scrollbars that removes the scrollbar, the viewport gets ~15 px wider and
 * the whole page — headers included — jumps. While the page actually has a
 * vertical scrollbar we mark <html> with `atlas-vscroll`, which reserves the
 * gutter (`scrollbar-gutter: stable`): the lock then keeps the same width.
 * Pages that don't scroll get no gutter, so nothing changes for them.
 */
export const SCROLL_GUTTER_CLASS = 'atlas-vscroll';

/** Pure decision, exported for tests. */
export function nextGutterState(opts: {
  current: boolean;
  /** `innerWidth - clientWidth`: a classic scrollbar, or the reserved gutter. */
  scrollbarWidth: number;
  scrollHeight: number;
  viewportHeight: number;
  /** A scroll lock (`overflow: hidden` on html/body) is active right now. */
  locked: boolean;
}): boolean {
  // Overlay scrollbars (phones, macOS default): nothing to compensate.
  if (opts.scrollbarWidth <= 0) return false;
  // No gutter reserved yet: a visible classic scrollbar means the page scrolls.
  if (!opts.current) return !opts.locked;
  // Gutter reserved: keep it during a lock (that's its whole point), otherwise
  // only while the content is still taller than the viewport.
  if (opts.locked) return true;
  return opts.scrollHeight > opts.viewportHeight + 1;
}

export function installScrollGutter(win: Window = window): () => void {
  const doc = win.document;
  const root = doc.documentElement;
  let frame = 0;
  const measure = () => {
    frame = 0;
    if (root.classList.contains('phone-shell')) {
      root.classList.remove(SCROLL_GUTTER_CLASS);
      return;
    }
    const current = root.classList.contains(SCROLL_GUTTER_CLASS);
    const hidden = (el: Element | null) => {
      if (!el) return false;
      const o = win.getComputedStyle(el).overflowY;
      return o === 'hidden' || o === 'clip';
    };
    const next = nextGutterState({
      locked: hidden(root) || hidden(doc.body),
      current,
      scrollbarWidth: win.innerWidth - root.clientWidth,
      scrollHeight: root.scrollHeight,
      viewportHeight: win.innerHeight,
    });
    if (next !== current) root.classList.toggle(SCROLL_GUTTER_CLASS, next);
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(measure);
  };
  schedule();
  win.addEventListener('resize', schedule, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  ro?.observe(root);
  if (doc.body) ro?.observe(doc.body);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  mo?.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
  if (doc.body) mo?.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style'] });
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    win.removeEventListener('resize', schedule);
    ro?.disconnect();
    mo?.disconnect();
  };
}
