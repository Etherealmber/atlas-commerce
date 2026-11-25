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
 * 4. Wizards (any dialog with step chips) and dirty dialogs:
 *    - every blocked attempt to move forward (« Continuer » or a later step chip
 *      that does not change the step) bounces the dialog — every time;
 *    - « Annuler », ✕, a click outside and Escape ask « Abandonner la saisie ? »
 *      first (outside / Escape also bounce). « Abandonner » then closes it for real.
 */

const DIALOG_SEL = '.modal, .modal-card, .ia-modal, [role="dialog"]:not(.ac-dp-pop)';
const BACKDROP_SEL = '[class*="backdrop"], [class*="overlay"]';
const POPOVER_OPEN_SEL = '.ac-dp-pop, [role="listbox"]';
const DIRTY_ATTR = 'data-ac-dirty';

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shake an element once — composes with any transform it already has. */
const lastBounce = new WeakMap<Element, number>();

export function bounce(el: Element | null | undefined): void {
  if (!el || !(el instanceof HTMLElement) || typeof el.animate !== 'function') return;
  // One shake per attempt: a wizard's own bounce and the global skip check never stack.
  const now = Date.now();
  if (now - (lastBounce.get(el) || 0) < 250) return;
  lastBounce.set(el, now);
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

const STEP_BTN_SEL = '.step-wizard__step-btn';
const CLOSE_SEL = '.modal-x, .modal-close, [aria-label^="Fermer"], [data-dialog-close]';

const isWizardDialog = (d: Element) => !!d.querySelector(STEP_BTN_SEL);

/** Top dialog whose dismissal must be confirmed: any wizard, or a dialog with typed input. */
function guardedTopDialog(): HTMLElement | null {
  const top = topmostDialog();
  if (!top || top.closest('[data-guard-ignore]')) return null;
  return top.hasAttribute(DIRTY_ATTR) || isWizardDialog(top) ? top : null;
}

/** « Annuler » / « Fermer » / ✕ inside a dialog (not the wizard's « Retour »). */
function cancelButtonOf(target: Element, dialog: HTMLElement): HTMLElement | null {
  const btn = target.closest('button, [role="button"]') as HTMLElement | null;
  if (!btn || !dialog.contains(btn) || btn.closest(POPOVER_OPEN_SEL)) return null;
  if (btn.closest('.ac-timed-delete, [data-guard-skip]')) return null; // « Annuler » = undo a timed delete
  if (btn.matches(CLOSE_SEL)) return btn;
  const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return text === 'annuler' || text === 'fermer' ? btn : null;
}

function findCloseControl(dialog: HTMLElement): HTMLElement | null {
  const direct = dialog.querySelector<HTMLElement>(CLOSE_SEL);
  if (direct) return direct;
  for (const b of Array.from(dialog.querySelectorAll<HTMLElement>('button'))) {
    const text = (b.textContent || '').trim().toLowerCase();
    if (text === 'annuler' || text === 'fermer') return b;
  }
  return null;
}

// ── « Abandonner la saisie ? » ───────────────────────────────────────────────

let bypassing = false;
let confirmEl: HTMLElement | null = null;
let confirmReturnFocus: HTMLElement | null = null;

function closeDiscardConfirm(): void {
  confirmEl?.remove();
  confirmEl = null;
  const back = confirmReturnFocus;
  confirmReturnFocus = null;
  if (back && back.isConnected) back.focus?.({ preventScroll: true });
}

/** Run `proceed` with the guard disabled (it replays the close the user asked for). */
function withBypass(proceed: () => void): void {
  bypassing = true;
  try { proceed(); } finally { bypassing = false; }
}

export function isDiscardConfirmOpen(): boolean {
  return !!confirmEl;
}

export function askDiscard(dialog: HTMLElement, proceed: () => void): void {
  if (typeof document === 'undefined') return;
  if (confirmEl) {
    bounce(confirmEl.querySelector('.ac-guard-confirm-card'));
    return;
  }
  const dirty = dialog.hasAttribute(DIRTY_ATTR);
  confirmReturnFocus = (document.activeElement as HTMLElement | null) || null;
  const wrap = document.createElement('div');
  wrap.className = 'ac-guard-confirm';
  wrap.innerHTML = `
    <div class="ac-guard-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="ac-guard-confirm-title" aria-describedby="ac-guard-confirm-desc">
      <h3 id="ac-guard-confirm-title">Abandonner la saisie ?</h3>
      <p id="ac-guard-confirm-desc">${dirty ? 'Les informations saisies ne seront pas enregistrées.' : 'Rien ne sera enregistré. Vous pourrez recommencer plus tard.'}</p>
      <div class="ac-guard-confirm-actions">
        <button type="button" class="secondary" data-guard-act="stay">Continuer la saisie</button>
        <button type="button" class="danger" data-guard-act="leave">Abandonner</button>
      </div>
    </div>`;
  wrap.addEventListener('click', (e) => {
    const t = e.target as Element;
    const act = t.closest('[data-guard-act]')?.getAttribute('data-guard-act');
    if (act === 'leave') {
      closeDiscardConfirm();
      withBypass(proceed);
    } else if (act === 'stay') {
      closeDiscardConfirm();
      bounce(dialog);
    } else if (t === wrap) {
      bounce(wrap.querySelector('.ac-guard-confirm-card'));
    }
  });
  document.body.appendChild(wrap);
  confirmEl = wrap;
  (wrap.querySelector('[data-guard-act="stay"]') as HTMLElement | null)?.focus({ preventScroll: true });
}

function onConfirmKey(e: KeyboardEvent): void {
  if (!confirmEl) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeDiscardConfirm();
    return;
  }
  if (e.key === 'Tab') {
    // Keep focus inside the two buttons (the dialog's own trap must not steal it).
    const btns = Array.from(confirmEl.querySelectorAll<HTMLElement>('button'));
    const i = btns.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    e.stopImmediatePropagation();
    const next = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i + 1) % btns.length;
    btns[next]?.focus();
  }
}

// ── Skipping ahead in a wizard: bounce every time it is refused ─────────────

function currentStepIndex(dialog: HTMLElement): number {
  const btns = Array.from(dialog.querySelectorAll(STEP_BTN_SEL));
  return btns.findIndex((b) => b.closest('[aria-current="step"]'));
}

function forwardAttempt(target: Element, dialog: HTMLElement): boolean {
  const chip = target.closest(STEP_BTN_SEL);
  if (chip && dialog.contains(chip)) {
    const btns = Array.from(dialog.querySelectorAll(STEP_BTN_SEL));
    return btns.indexOf(chip) > currentStepIndex(dialog);
  }
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn || !dialog.contains(btn) || btn.disabled) return false;
  return /^(continuer|suivant)\b/i.test((btn.textContent || '').trim());
}

function watchSkip(target: Element): void {
  const dialog = topmostDialog();
  if (!dialog || !dialog.contains(target) || !isWizardDialog(dialog) || !forwardAttempt(target, dialog)) return;
  const before = currentStepIndex(dialog);
  if (before < 0) return;
  window.setTimeout(() => {
    if (dialog.isConnected && currentStepIndex(dialog) === before) bounce(dialog);
  }, 40);
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
  if (bypassing) return;
  const t = e.target as Element | null;
  if (!t || !(t instanceof Element)) return;
  if (confirmEl && confirmEl.contains(t)) return;

  const dialog = guardedTopDialog();
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
      if (!popoverOpenAtDown) {
        bounce(dialog);
        const close = findCloseControl(dialog);
        askDiscard(dialog, () => {
          if (close && close.isConnected) close.click();
          else t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
      }
      popoverOpenAtDown = false;
    }
    return;
  }

  if (dialog && dialog.contains(t)) {
    const cancel = cancelButtonOf(t, dialog);
    if (cancel) {
      if (e.type === 'click') {
        e.preventDefault();
        e.stopPropagation();
        askDiscard(dialog, () => { if (cancel.isConnected) cancel.click(); });
      }
      return;
    }
  }

  if (e.type === 'click') watchSkip(t);

  if (e.type === 'click' && pageGuard && !(e as MouseEvent).defaultPrevented && isLeaving(t)) {
    e.preventDefault();
    e.stopPropagation();
    pageGuard.onBlocked();
  }
}

function onKey(e: KeyboardEvent): void {
  if (confirmEl) { onConfirmKey(e); return; }
  if (e.key !== 'Escape' || bypassing) return;
  if (document.querySelector(POPOVER_OPEN_SEL)) return; // let the popover close first
  const dialog = guardedTopDialog();
  if (!dialog) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  bounce(dialog);
  const close = findCloseControl(dialog);
  const origin = (e.target as Element | null) || dialog;
  askDiscard(dialog, () => {
    if (close && close.isConnected) close.click();
    else origin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
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
