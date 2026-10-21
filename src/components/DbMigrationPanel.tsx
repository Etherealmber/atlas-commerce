import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type TableStat = { name: string; rows: number };
type Status = { enabled: boolean; primary: string; source: TableStat[]; target: TableStat[] };

/**
 * v232 — D1 → D1 migration tooling (owner only).
 * Copies every table (schema + rows, chunked) from the main database (company-stock-db)
 * into the optional DB_TARGET binding (atlas-db), then flips the app over with a cutover flag.
 */
export default function DbMigrationPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<'idle' | 'copy' | 'cutover' | 'back'>('idle');
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await api.dbMigrateStatus();
      setStatus(r.data || null);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSource = (status?.source || []).reduce((a, t) => a + Math.max(0, t.rows), 0);
  const totalTarget = (status?.target || []).reduce((a, t) => a + Math.max(0, t.rows), 0);

  const copy = async () => {
    setBusy('copy');
    setError('');
    stopRef.current = false;
    let cursor: Record<string, number> = {};
    let copiedTotal = 0;
    try {
      for (let pass = 0; pass < 400; pass++) {
        if (stopRef.current) break;
        const r = await api.dbMigrateCopy({ cursor });
        cursor = r.data?.cursor || {};
        copiedTotal += Object.values(r.data?.copied || {}).reduce((a, b) => a + b, 0);
        setProgress(`${copiedTotal} ligne(s) copiée(s)…`);
        if (!Object.keys(cursor).length) break;
      }
      await load();
      setProgress(stopRef.current ? 'Copie interrompue.' : 'Copie terminée ✓');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy('idle');
    }
  };

  const cutover = async (on: boolean) => {
    setBusy(on ? 'cutover' : 'back');
    setError('');
    try {
      await api.dbMigrateCutover(on);
      await load();
      setProgress(on ? 'Bascule effectuée : l’application lit/écrit désormais atlas-db.' : 'Retour à company-stock-db.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div className="db-mig-panel">
      <h3 style={{ marginTop: 0 }}>Base de données &amp; migration</h3>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
        Copie intégrale (schéma + données) de <code>company-stock-db</code> vers <code>atlas-db</code> (binding D1
        « DB_TARGET »), puis bascule définitive depuis les Paramètres. Aucune donnée n’est supprimée.
      </p>
      {!status?.enabled ? (
        <div className="modal-note">
          Binding « DB_TARGET » non détecté sur ce déploiement. Ajoutez la base D1 <code>atlas-db</code> comme
          binding <code>DB_TARGET</code> (wrangler.jsonc ou tableau de bord Cloudflare) puis redéployez pour activer
          la migration.
        </div>
      ) : (
        <>
          <div className="db-mig-grid">
            <div>
              <strong>Source (company-stock-db)</strong>
              <span className="muted">{totalSource} lignes · {(status?.source || []).length} tables</span>
            </div>
            <div>
              <strong>Cible (atlas-db)</strong>
              <span className="muted">{totalTarget} lignes · {(status?.target || []).length} tables</span>
            </div>
            <div>
              <strong>Base active</strong>
              <span className="muted">{status?.primary === 'target' ? 'atlas-db' : 'company-stock-db'}</span>
            </div>
          </div>
          <div className="db-mig-actions">
            <button type="button" disabled={busy !== 'idle'} onClick={() => void copy()}>
              {busy === 'copy' ? 'Copie en cours…' : 'Copier les données'}
            </button>
            {busy === 'copy' && (
              <button type="button" className="secondary" onClick={() => { stopRef.current = true; }}>
                Arrêter
              </button>
            )}
            {status?.primary !== 'target' ? (
              <button type="button" disabled={busy !== 'idle'} onClick={() => void cutover(true)}>
                {busy === 'cutover' ? 'Bascule…' : 'Basculer définitivement vers atlas-db'}
              </button>
            ) : (
              <button type="button" className="secondary" disabled={busy !== 'idle'} onClick={() => void cutover(false)}>
                {busy === 'back' ? 'Retour…' : 'Revenir à company-stock-db'}
              </button>
            )}
            <button type="button" className="secondary" disabled={busy !== 'idle'} onClick={() => void load()}>
              Actualiser
            </button>
          </div>
          {progress && <p className="db-mig-progress" role="status">{progress}</p>}
          {error && <p className="db-mig-error" role="alert">{error}</p>}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            La copie procède par lots de 200 lignes (reprise possible) ; la bascule écrit un drapeau
            <code> db_primary</code> dans les deux bases — réversible à tout moment.
          </p>
        </>
      )}
    </div>
  );
}
