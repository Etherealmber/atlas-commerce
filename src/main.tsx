
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
import './styles/dark-force.css'; /* absolute last — dark surfaces */
import { isNativeApp } from './config';
import { applyDensityFromStorage } from './lib/density';
import { installCrashReporting } from './lib/crashReporter';

// v260 — global crash reporting (fire-and-forget, throttled, sanitized server-side)
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
      background: #111113 !important;
      color: #f4f4f5 !important;
      border-color: #2a2a2e !important;
    }
    html[data-theme="dark"] .ac-mail-panel .ac-notif-item,
    html[data-theme="dark"] button.ac-notif-item {
      background: #27272a !important;
      color: #e4e4e7 !important;
      border: 1px solid #3f3f46 !important;
    }
    html[data-theme="dark"] .ac-mail-panel .ac-notif-item:hover,
    html[data-theme="dark"] button.ac-notif-item:hover,
    html[data-theme="dark"] button.ac-notif-item:active {
      background: #3f3f46 !important;
      color: #fafafa !important;
    }
    html[data-theme="dark"] .account-menu-panel .account-menu-item,
    html[data-theme="dark"] .account-menu-panel--portal .account-menu-item {
      background: #27272a !important;
      color: #f4f4f5 !important;
      border: 1px solid #3f3f46 !important;
    }
    .sidebar .logo-mark { color: inherit !important; }
    .sidebar nav a { color: #475569 !important; }
    html[data-theme="dark"] .sidebar nav a { color: #a1a1aa !important; }
    .sidebar nav a.active { background: #f1f5f9 !important; color: #0f172a !important; }
    html[data-theme="dark"] .sidebar nav a.active { background: #1a1a1a !important; color: #fafafa !important; }
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="root">
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// Offline PWA: cache shell + GET /api/* for hors-ligne scan / catalogue
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=11').then((reg) => {
      // Prefer fresh worker after deploy
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {});
  });
}
