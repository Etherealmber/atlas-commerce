/** v209 panels — alertes stock/documents (M5), références fournisseur (L7), kits & assemblages (L6). */
import { useEffect, useState } from 'react';
import { api } from '../api';
import RefreshIconButton from './RefreshIconButton';

const DEFAULT_ALERTS = [
  { key: 'stock_low', label: 'Stock sous le seuil', threshold: 0 },
  { key: 'stock_out', label: 'Rupture de stock', threshold: 0 },
  { key: 'invoice_overdue', label: 'Facture échue', threshold: 0 },
  { key: 'quote_stale', label: 'Devis sans réponse (jours)', threshold: 7 },
];

export function AlertsPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [busyKey, setBusyKey] = useState('');
  const load = () => {
    api.getAlertSettings().then((r: any) => {
      const have = r?.data || [];
      const merged = DEFAULT_ALERTS.map((d) => ({ ...d, enabled: 1, ...have.find((h: any) => h.key === d.key) }));
      setRows(merged);
    }).catch(() => setRows(DEFAULT_ALERTS.map((d) => ({ ...d, enabled: 1 }))));
  };
  useEffect(load, []);
  const save = async (row: any, patch: any) => {
    setBusyKey(row.key);
    try {
      await api.saveAlertSetting({ ...row, ...patch });
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
    } finally {
      setBusyKey('');
    }
  };
  return (
    <div className="ac-panel" style={{ marginTop: 16 }}>
      <div className="ac-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>Alertes stock & documents</strong>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>déclenchent les webhooks (événement atlas.alert)</span>
        <span style={{ marginLeft: 'auto' }}><RefreshIconButton onClick={() => load()} /></span>
      </div>
      <div className="table-wrap">
        <table className="data-dense">
          <thead><tr><th>Alerte</th><th>Seuil</th><th style={{ width: 90 }}>Active</th><th style={{ width: 90 }}>Test</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>
                  <input
                    type="number"
                    style={{ width: 80 }}
                    value={r.threshold}
                    disabled={busyKey === r.key}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, threshold: Number(e.target.value) } : x)))}
                    onBlur={(e) => void save(r, { threshold: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={!!r.enabled} disabled={busyKey === r.key} onChange={(e) => void save(r, { enabled: e.target.checked ? 1 : 0 })} />
                </td>
                <td>
                  <button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} disabled={busyKey === r.key} onClick={() => void api.saveAlertSetting({ ...r, test: true }).then(() => alert('Test envoyé aux webhooks.'))}>
                    Tester
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


