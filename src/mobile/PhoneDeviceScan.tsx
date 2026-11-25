import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, ScanLine, Smartphone } from 'lucide-react';
import { api } from '../api';
import { startDeviceQrScan } from '../lib/barcodeScan';
import { deviceApprovalPath } from './phoneDeviceQr';
import { getScanPreference, phoneScanFeedback } from './phoneScanPreferences';

export interface LinkedDevice {
  full: string;
  label: string;
  meta: string;
  current: boolean;
  mobile: boolean;
}

/** Normalise `/api/auth/devices` rows: partial or malformed server data never crashes the page. */
export function normalizeLinkedDevices(raw: unknown): LinkedDevice[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.flatMap((row): LinkedDevice[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    const full = typeof r.full === 'string' ? r.full : '';
    if (!full) return [];
    const ua = typeof r.user_agent === 'string' ? r.user_agent : '';
    const label = (typeof r.device_label === 'string' && r.device_label) || (typeof r.fingerprint === 'string' && r.fingerprint) || 'Appareil';
    const place = [r.city, r.country].filter((x): x is string => typeof x === 'string' && x.length > 0).join(', ');
    const meta = [typeof r.last_seen === 'string' ? r.last_seen : '', typeof r.last_ip === 'string' && r.last_ip ? `IP ${r.last_ip}` : '', place]
      .filter(Boolean).join(' · ');
    return [{ full, label, meta, current: r.current === true, mobile: /android|iphone|ipad|mobile/i.test(ua) }];
  });
}

function LinkedDevices() {
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [error, setError] = useState(false);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try { const res = await api.getDevices(); setDevices(normalizeLinkedDevices(res?.data)); setError(false); }
    catch { setDevices([]); setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const revoke = async (d: LinkedDevice) => {
    try {
      await api.revokeDevice(d.full);
      setDevices(prev => (prev || []).filter(x => x.full !== d.full));
      setNote('Appareil révoqué : un code OTP lui sera demandé à sa prochaine connexion.');
    } catch { setNote('Révocation impossible pour le moment. Réessayez.'); }
  };
  return <section className="ph-linked" aria-labelledby="ph-linked-title">
    <div className="ph-linked-head"><h2 id="ph-linked-title">Appareils connectés</h2>{devices && <span className="ph-linked-count">{devices.length}</span>}</div>
    {devices === null && <p className="ph-linked-empty">Chargement…</p>}
    {devices && devices.length === 0 && <p className="ph-linked-empty">{error ? 'Liste indisponible. Vérifiez la connexion.' : 'Aucun appareil enregistré.'}</p>}
    {devices && devices.length > 0 && <ul className="ph-linked-list">
      {devices.map(d => <li key={d.full} className="ph-linked-row">
        <span className="ph-linked-ico" aria-hidden="true">{d.mobile ? <Smartphone size={18} /> : <Monitor size={18} />}</span>
        <span className="ph-linked-main">
          <strong>{d.current ? 'Cet appareil' : d.label}{d.current && <em className="ph-linked-chip">actuel</em>}</strong>
          {d.meta && <small>{d.meta}</small>}
        </span>
        {!d.current && <button type="button" className="ph-linked-revoke" onClick={() => void revoke(d)}>Révoquer</button>}
      </li>)}
    </ul>}
    {note && <p className="ph-linked-note" role="status">{note}</p>}
  </section>;
}

export default function PhoneDeviceScan() {
  const reader = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('Démarrez la caméra et scannez le QR de connexion desktop v2.');
  const stop = () => {
    generation.current++;
    stopRef.current?.(); stopRef.current = null;
    setActive(false);
  };
  useEffect(() => () => { generation.current++; stopRef.current?.(); stopRef.current = null; }, []);
  const start = async () => {
    stop();
    const current = generation.current;
    setMessage('Placez le QR dans le cadre.');
    setActive(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (current !== generation.current || !reader.current) return;
    try {
      const close = await startDeviceQrScan(reader.current, raw => {
        if (current !== generation.current) return;
        const path = deviceApprovalPath(raw, window.location.origin);
        stop();
        if (path) { phoneScanFeedback(); window.location.assign(path); }
        else setMessage('QR non compatible ou d’un autre serveur. Scannez une demande desktop v2 de ce serveur.');
      });
      if (current !== generation.current) close(); else stopRef.current = close;
    } catch {
      if (current === generation.current) { setActive(false); setMessage('Caméra ou lecteur QR indisponible. Vérifiez les autorisations et réessayez.'); }
    }
  };
  useEffect(() => { if (getScanPreference('autoCamera')) void start(); }, []);
  return <section className="ph-device-page">
    <div className="ph-device-heading"><ScanLine size={24} aria-hidden="true" /><div><h1>Scanner un appareil</h1><p>Connexion desktop</p></div></div>
    {!active && <div className="ph-scan-idle"><span className="ph-scan-idle-icon"><ScanLine size={30} aria-hidden="true" /></span><h2>Lecteur QR en veille</h2><p>{message}</p><button type="button" className="ph-scan-start" onClick={() => void start()}>Démarrer la caméra QR</button></div>}
    <div className="ph-cam-wrap ph-device-camera" hidden={!active}><div ref={reader} id="ph-device-reader" className="ph-scan-reader ph-h5-reader" />{active && <button type="button" className="ph-cam-close" onClick={stop}>Fermer</button>}</div>
    {active && <p role="status">{message}</p>}
    <p className="ph-device-note">Seuls les QR desktop v2 de ce serveur sont acceptés. La demande doit ensuite être comparée et confirmée ; scanner ne connecte pas l’appareil.</p>
    <LinkedDevices />
  </section>;
}
