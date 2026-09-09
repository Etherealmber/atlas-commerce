import { useEffect, useState } from 'react';

/** In-app offline screen — not the browser's default offline page */
export default function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;

  return (
    <div className="atlas-offline" role="alert">
      <div className="atlas-offline-card">
        <div className="atlas-offline-ico" aria-hidden>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M1 1l22 22" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M12 20h.01" />
          </svg>
        </div>
        <h2>Pas de connexion</h2>
        <p>
          Atlas Commerce ne peut pas joindre le serveur. Vérifiez le Wi‑Fi ou les données mobiles,
          puis réessayez. Vos dernières données affichées restent visibles hors ligne.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => window.location.reload()}
        >
          Réessayer
        </button>
        <p className="atlas-offline-hint">Astuce : un café pendant que le réseau revient ?</p>
      </div>
    </div>
  );
}
