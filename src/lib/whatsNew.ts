import { WHATS_NEW_VERSION, semverAtMost } from '../version';

const SEEN_KEY = 'atlas-whats-new-seen';
const MODAL_KEY = 'atlas-whats-new-modal-seen';

/** Accept legacy beta markers without rewriting or downgrading stored history. */
function coversPublishedRelease(seen: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(seen)
    && semverAtMost(WHATS_NEW_VERSION, seen);
}

export function getSeenWhatsNewVersion(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return '';
  }
}

export function markWhatsNewSeen(version: string = WHATS_NEW_VERSION): void {
  try {
    if (!coversPublishedRelease(localStorage.getItem(SEEN_KEY) || '')) localStorage.setItem(SEEN_KEY, version);
    if (!coversPublishedRelease(localStorage.getItem(MODAL_KEY) || '')) localStorage.setItem(MODAL_KEY, version);
  } catch {
    /* Storage may be unavailable; reading release notes still works. */
  }
}

export function hasUnreadWhatsNew(): boolean {
  return !coversPublishedRelease(getSeenWhatsNewVersion());
}

/** Show once per published release, not once per application build. */
export function shouldShowWhatsNewModal(): boolean {
  try {
    return !coversPublishedRelease(localStorage.getItem(MODAL_KEY) || '')
      && !coversPublishedRelease(localStorage.getItem(SEEN_KEY) || '');
  } catch {
    return false;
  }
}

export function markWhatsNewModalSeen(version: string = WHATS_NEW_VERSION): void {
  try {
    if (!coversPublishedRelease(localStorage.getItem(MODAL_KEY) || '')) localStorage.setItem(MODAL_KEY, version);
  } catch {
    /* Storage may be unavailable. */
  }
}
