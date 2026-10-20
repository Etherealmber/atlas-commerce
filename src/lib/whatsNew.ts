import { APP_VERSION } from '../version';

const SEEN_KEY = 'atlas-whats-new-seen';
const MODAL_KEY = 'atlas-whats-new-modal-seen';

export function getSeenWhatsNewVersion(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return '';
  }
}

export function markWhatsNewSeen(version: string = APP_VERSION): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
    localStorage.setItem(MODAL_KEY, version);
  } catch {
    /* */
  }
}

export function hasUnreadWhatsNew(): boolean {
  const seen = getSeenWhatsNewVersion();
  if (!seen) return true;
  return seen !== APP_VERSION;
}

/** Show once-per-version modal until user dismisses or visits /whats-new */
export function shouldShowWhatsNewModal(): boolean {
  try {
    const modalSeen = localStorage.getItem(MODAL_KEY) || '';
    return modalSeen !== APP_VERSION;
  } catch {
    return false;
  }
}

export function markWhatsNewModalSeen(version: string = APP_VERSION): void {
  try {
    localStorage.setItem(MODAL_KEY, version);
  } catch {
    /* */
  }
}
