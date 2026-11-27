import { controllerChangeRequiresReload } from './lib/serviceWorkerController';

// Permanently disable liquid glass (stuck blur on some devices)
try {
  document.documentElement.setAttribute('data-liquid-glass', 'off');
  document.documentElement.setAttribute('data-glass', 'off');
  document.documentElement.classList.remove('liquid-glass-active');
  localStorage.setItem('atlas-liquid-glass', 'off');
  localStorage.setItem('atlas-glass', 'off');
} catch (_) {}

import './components/erp/atlas-tokens.css';
import './components/erp/mode-compat.css';
import './components/erp/crm-parties.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './styles/theme.css';
import './styles/shell.css';
import './styles/focus-pages-chrome.css';
import './styles/purge-green-glass.css';
import './styles/motion-polish.css';
import './styles/overrides-final.css';
import './styles/bits.css';
import './styles/focus-sidebar.css';
import './styles/density-compact.css';
import './styles/element-pills.css'; /* in-element action pills (Produits row style) */
import './styles/input-actions.css'; /* buttons beside fields + settings save bar */
import './styles/button-groups.css'; /* one height per button row + popup footers */
import './styles/form-controls.css'; /* date pickers, selects, settings top actions, product grid */
import './styles/tables.css'; /* one modern look for every list table */
import './styles/guard-confirm.css'; /* « Abandonner la saisie ? » above dialogs */
import './styles/atlas-agent-workspace.css'; /* Agent workspace, before dark overrides */
import './styles/dark-force.css'; /* absolute last — dark surfaces */
import { isNativeApp } from './config';
import { applyDensityFromStorage } from './lib/density';
import { installCrashReporting } from './lib/crashReporter';
import { installUnsavedGuards } from './lib/unsavedGuard';
import { installScrollGutter } from './lib/scrollGutter';
import { installI18n } from './i18n';
import './styles/rtl.css'; /* Arabic: right-to-left shell */
import './styles/controls.css'; /* shared checkbox / select look — after every theme file */

// v260 — global crash reporting (fire-and-forget, throttled, sanitized server-side)
installI18n();
installCrashReporting();

document.title = 'Atlas Commerce';

// Critical shell colors before React paint (beats stale CSS chunks)
try {
  const s = document.createElement('style');
  s.id = 'atlas-critical-shell';
  s.textContent = `
    .sidebar, aside.sidebar {
      background: #fff !important;
      color: #0f172a !important;
      border-right: 1px solid #e8eaef !important;
    }
    html[data-theme="dark"] .sidebar, html[data-theme="dark"] aside.sidebar,
    html[data-theme="dark"] .ac-topbar, html[data-theme="dark"] .settings-topbar,
    html[data-theme="dark"] .content, html[data-theme="dark"] body {
      background: #121215 !important;
      color: #e4e4e7 !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
    }
    html[data-theme="dark"] .ac-mail-panel .ac-notif-item,
    html[data-theme="dark"] button.ac-notif-item {
      background: transparent !important;
      color: #f4f4f5 !important;
      border: 1px solid transparent !important;
    }
    html[data-theme="dark"] .ac-mail-panel .ac-notif-item:hover,
    html[data-theme="dark"] button.ac-notif-item:hover,
    html[data-theme="dark"] button.ac-notif-item:active {
      background: #27272b !important;
      color: #fafafa !important;
    }
    html[data-theme="dark"] .account-menu-panel .account-menu-item,
    html[data-theme="dark"] .account-menu-panel--portal .account-menu-item {
      background: #27272b !important;
      color: #f4f4f5 !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
    }
    .sidebar .logo-mark { color: inherit !important; }
    .sidebar nav a { color: #475569 !important; }
    html[data-theme="dark"] .sidebar nav a { color: #a1a1aa !important; }
    .sidebar nav a.active { background: #f1f5f9 !important; color: #0f172a !important; }
    html[data-theme="dark"] .sidebar nav a.active { background: #27272b !important; color: #fafafa !important; }
    [data-atlas-delete-btn="1"], .ac-timed-delete [role="button"],
    button.ac-timed-delete-btn, .ac-timed-delete-btn, .ac-btn.ac-btn-delete,
    .content button.ac-timed-delete-btn, .content button.danger.ac-timed-delete-btn,
    .bal-tx-actions button.ac-timed-delete-btn {
      background: #ef4444 !important; background-color: #ef4444 !important;
      background-image: none !important; color: #fff !important;
      border: none !important; border-radius: 999px !important; font-weight: 700 !important;
      -webkit-text-fill-color: #fff !important;
    }
    button.ac-timed-delete-btn.is-armed, .content button.ac-timed-delete-btn.is-armed {
      background: #fee2e2 !important; color: #b91c1c !important;
      -webkit-text-fill-color: #b91c1c !important;
    }
  `;
  document.head.appendChild(s);
} catch { /* */ }


// Density before paint — avoids flash of wrong spacing
try {
  applyDensityFromStorage();
} catch { /* */ }
try {
  const ts = localStorage.getItem('atlas-type-scale') || 'md';
  document.documentElement.dataset.typeScale = ts;
} catch { /* */ }

if (typeof document !== 'undefined') {
  try {
    if (isNativeApp()) {
      document.documentElement.classList.add('is-native');
      document.body.classList.add('is-native');
    }
  } catch { /* ignore */ }
}

// Before React mounts, so its capture listeners run ahead of the app's own.
installUnsavedGuards();
installScrollGutter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="root">
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// v0.7 — splash (logo + loader) fades out as soon as the React shell lands
(function hideSplashWhenReady() {
  if (typeof document === 'undefined') return;
  const splash = document.getElementById('splash');
  const rootEl = document.getElementById('root');
  if (!splash || !rootEl) return;
  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    requestAnimationFrame(() => {
      splash.classList.add('sp-hide');
      window.setTimeout(() => splash.remove(), 180);
    });
  };
  if (rootEl.children.length) {
    hide();
    return;
  }
  const mo = new MutationObserver(() => {
    if (rootEl.children.length) {
      mo.disconnect();
      hide();
    }
  });
  mo.observe(rootEl, { childList: true });
  // Safety net: never trap the user behind the splash
  window.setTimeout(() => {
    mo.disconnect();
    hide();
  }, 15000);
})();

// Offline PWA: cache shell + GET /api/* for hors-ligne scan / catalogue
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Initial activation may claim this tab; that is not an update and must not reload it.
    const shouldReloadForController = controllerChangeRequiresReload(!!navigator.serviceWorker.controller);
    navigator.serviceWorker.register('/sw.js?v=12').then((reg) => {
      // Prefer fresh worker after deploy
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage has no targetOrigin
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage has no targetOrigin
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {});
    // v0.7 — when a fresher worker takes control, reload ONCE so the open tab
    // never keeps rendering the previous bundle after a deploy.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!shouldReloadForController()) return;
      try {
        if (sessionStorage.getItem('atlas-sw-reload')) return;
        sessionStorage.setItem('atlas-sw-reload', '1');
        window.location.reload();
      } catch { /* */ }
    });
  });
}
