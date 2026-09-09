import './components/erp/atlas-tokens.css';
import './components/erp/mode-compat.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { isNativeApp } from './config';
import { applyDensityFromStorage } from './lib/density';

document.title = 'Atlas Commerce — Stock & facturation';

// Density before paint — avoids flash of wrong spacing
try {
  applyDensityFromStorage();
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
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

// Offline PWA: cache shell + GET /api/* for hors-ligne scan / catalogue
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=7').then((reg) => {
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
