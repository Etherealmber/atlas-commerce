/**
 * Unsaved-changes guards (v0.9.3).
 *
 * 1. Dialogs: as soon as the user types or changes a field inside a dialog,
 *    the dialog is marked dirty. A click on its backdrop or the Escape key then
 *    bounces the dialog instead of closing it (and losing the input). The
 *    explicit « Annuler » / ✕ buttons still close it.
 * 2. Pages: a page with unsaved changes (Settings) registers a page guard.
 *    While it is active, links, sidebar entries and browser back cannot leave
 *    the page/section; the page is told so it can bounce its save actions.
 *    Elements inside `[data-unsaved-allow]` (its own save / cancel buttons)
 *    keep working.
 * 3. `bounce(el)`: one short shake (reduced motion: a red ring), used for both
 *    cases and for validation errors.
 */

const DIALOG_SEL = '.modal, .modal-card, .ia-modal, [role="dialog"]:not(.ac-dp-pop)';
const BACKDROP_SEL = '[class*="backdrop"], [class*="overlay"]';
const POPOVER_OPEN_SEL = '.ac-dp-pop, [role="listbox"]';
const DIRTY_ATTR = 'data-ac-dirty';

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shake an element once — composes with any transform it already has. */
export function bounce(el: Element | null | undefined): void {
  if (!el || !(el instanceof HTMLElement) || typeof el.animate !== 'function') return;
  if (reducedMotion()) {
    el.animate(
      [{ outline: '0 solid rgba(239,68,68,0)' }, { outline: '3px solid rgba(239,68,68,.55)', offset: 0.35 }, { outline: '0 solid rgba(239,68,68,0)' }],
      { duration: 650, easing: 'ease-out' },
    );
    return;
  }
  el.animate(
    [
      { translate: '0 0' },
      { translate: '-10px 0', offset: 0.14 },
      { translate: '9px 0', offset: 0.3 },
      { translate: '-6px 0', offset: 0.46 },
      { translate: '4px 0', offset: 0.62 },
      { translate: '-2px 0', offset: 0.78 },
      { translate: '0 0' },
    ],
    { duration: 480, easing: 'cubic-bezier(.36,.07,.19,.97)' },
  );
}

/** Bounce the dialog that contains `el` (wizard step error, form error…). */
export function bounceDialogOf(el: Element | null | undefined): void {
  bounce(el?.closest(DIALOG_SEL));
}

// ── Page guard ───────────────────────────────────────────────────────────────

type PageGuard = { onBlocked: () => void; url: string; state: unknown };
let pageGuard: PageGuard | null = null;

/** Activate (or clear with `null`) the page guard. */
export function setPageGuard(onBlocked: (() => void) | null): void {
  pageGuard = onBlocked
    ? { onBlocked, url: window.location.href, state: window.history.state }
    : null;
}

export const isPageGuarded = () => pageGuard !== null;

function sameDocumentTarget(a: HTMLAnchorElement): boolean {
  if (a.target && a.target !== '_self') return true;
  if (a.hasAttribute('download')) return true;
  let url: URL;
  try { url = new URL(a.href, window.location.href); } catch { return true; }
  if (url.origin !== window.location.origin) return true; // external: new context
  return url.pathname === window.location.pathname && url.search === window.location.search;
}

/** Is this click an attempt to leave the current page / section? */
function isLeaving(target: Element): boolean {
  if (target.closest('[data-unsaved-allow]')) return false;
  const a = target.closest('a[href]') as HTMLAnchorElement | null;
  if (a) return !sameDocumentTarget(a);
  // Sidebar entries, menu items and explicit navigation buttons — not the
  // toggles that only open / collapse something.
  const btn = target.closest('aside button, nav button, [role="menuitem"], [data-nav]');
  if (!btn) return false;
  return !btn.matches('[aria-expanded], [aria-pressed], [aria-haspopup]');
}

// ── Dialog guard ─────────────────────────────────────────────────────────────

function topmostDialog(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(DIALOG_SEL)).filter((d) => d.isConnected && d.getClientRects().length > 0);
  return all.length ? all[all.length - 1] : null;
}

function dirtyTopDialog(): HTMLElement | null {
  const top = topmostDialog();
  return top && top.hasAttribute(DIRTY_ATTR) ? top : null;
}

function markDirty(e: Event): void {
  const t = e.target as Element | null;
  if (!t || !(t instanceof Element)) return;
  if (t.closest('[data-guard-ignore]') || (t as HTMLInputElement).type === 'search') return;
  const dialog = t.closest(DIALOG_SEL);
  if (dialog) dialog.setAttribute(DIRTY_ATTR, '1');
}

let popoverOpenAtDown = false;

function onPointer(e: Event): void {
  const t = e.target as Element | null;
  if (!t || !(t instanceof Element)) return;

  const dialog = dirtyTopDialog();
  if (dialog && !dialog.contains(t) && !t.closest(POPOVER_OPEN_SEL) && (t.contains(dialog) || t.matches(BACKDROP_SEL))) {
    if (e.type === 'mousedown') {
      // An open date picker / list closes on this mousedown: let it through,
      // but the click that follows must still not close the dialog.
      popoverOpenAtDown = !!document.querySelector(POPOVER_OPEN_SEL);
      if (popoverOpenAtDown) return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'click') {
      if (!popoverOpenAtDown) bounce(dialog);
      popoverOpenAtDown = false;
    }
    return;
  }

  if (e.type === 'click' && pageGuard && !(e as MouseEvent).defaultPrevented && isLeaving(t)) {
    e.preventDefault();
    e.stopPropagation();
    pageGuard.onBlocked();
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector(POPOVER_OPEN_SEL)) return; // let the popover close first
  const dialog = dirtyTopDialog();
  if (!dialog) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  bounce(dialog);
}

function onPop(e: PopStateEvent): void {
  if (!pageGuard) return;
  // Runs before React Router's own listener (capture phase on window).
  e.stopImmediatePropagation();
  window.history.pushState(pageGuard.state, '', pageGuard.url);
  pageGuard.onBlocked();
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!pageGuard) return;
  e.preventDefault();
  e.returnValue = '';
}

let installed = false;

/** Install the listeners once, as early as possible (main.tsx). */
export function installUnsavedGuards(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('input', markDirty, true);
  document.addEventListener('change', markDirty, true);
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('click', onPointer, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', onPop, true);
  window.addEventListener('beforeunload', onBeforeUnload);
}
