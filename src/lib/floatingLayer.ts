/**
 * v0.9.3 — Outside-click helpers.
 *
 * Dialogs and menus are portaled to <body>, so a click inside them is "outside"
 * the DOM subtree of the component that opened them. Outside-click handlers that
 * ignore this close their parent — which unmounts the dialog it owns, and the
 * popup disappears on its own. Use `isInFloatingLayer` to skip those clicks.
 */
export const FLOATING_LAYER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '.ac-lang-layer',
  '.ac-topbar-menu-backdrop',
  '.modal-overlay',
].join(', ');

export function isInFloatingLayer(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(el?.closest(FLOATING_LAYER_SELECTOR));
}
