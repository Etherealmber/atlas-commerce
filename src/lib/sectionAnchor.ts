import type { MouseEvent } from 'react';

/** Keep the link's native fallback and modified clicks; reliably re-scroll an
 * already-selected fragment, including after translated text has changed. */
export function openSection(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  if (window.location.hash !== `#${id}`) window.location.hash = id;
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
}
