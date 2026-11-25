import './backup-panel.css';

type BackupItem = { key: string; size?: number; uploaded?: string | null };

function parseStamp(item: BackupItem): number {
  if (item.uploaded) {
    const t = Date.parse(item.uploaded);
    if (Number.isFinite(t)) return t;
  }
  const m = String(item.key).match(/atlas-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (m) {
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function relative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

function formatSize(bytes?: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * v0.9.3 — summary of the R2 backups, computed only from the listing the
 * Settings page already loads (no extra request, no D1 read).
 */
export default function BackupStatusStrip({ list, now = Date.now() }: { list: BackupItem[]; now?: number }) {
  let latest: BackupItem | null = null;
  let latestAt = 0;
  for (const item of list) {
    const at = parseStamp(item);
    if (at > latestAt || (!latest && item.key === 'backups/latest.abk')) { latest = item; latestAt = at; }
  }
  const snapshots = list.filter((x) => String(x.key || '').startsWith('backups/30m/')).length;
  const stale = latestAt > 0 && now - latestAt > 36 * 3600 * 1000;
  const tone = !latestAt ? 'bk-dot--idle' : stale ? 'bk-dot--warn' : 'bk-dot--ok';
  return (
    <div className="bk-strip" role="status">
      <div className="bk-stat">
        <span className="bk-stat-label"><span className={`bk-dot ${tone}`} aria-hidden="true" />Dernière sauvegarde</span>
        <strong title={latestAt ? new Date(latestAt).toLocaleString('fr-FR') : undefined}>
          {latestAt ? relative(latestAt, now) : list.length ? 'Disponible' : 'Aucune'}
        </strong>
      </div>
      <div className="bk-stat">
        <span className="bk-stat-label">Taille</span>
        <strong>{formatSize(latest?.size)}</strong>
      </div>
      <div className="bk-stat">
        <span className="bk-stat-label">Points de restauration</span>
        <strong>{snapshots || list.length || 0}</strong>
      </div>
      <div className="bk-stat bk-stat--chips">
        <span className="bk-chip">AES-256-GCM</span>
        <span className="bk-chip">Toutes les 12 h</span>
        <span className="bk-chip">Rétention 7 j</span>
      </div>
    </div>
  );
}
