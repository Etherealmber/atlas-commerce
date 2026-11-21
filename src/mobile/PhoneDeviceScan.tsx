import { useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { startDeviceQrScan } from '../lib/barcodeScan';
import { deviceApprovalPath } from './phoneDeviceQr';

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
        if (path) window.location.assign(path);
        else setMessage('QR non compatible ou d’un autre serveur. Scannez une demande desktop v2 de ce serveur.');
      });
      if (current !== generation.current) close(); else stopRef.current = close;
    } catch {
      if (current === generation.current) { setActive(false); setMessage('Caméra ou lecteur QR indisponible. Vérifiez les autorisations et réessayez.'); }
    }
  };
  return <section className="ph-device-page">
    <div className="ph-device-heading"><ScanLine size={24} aria-hidden="true" /><div><h1>Scanner un appareil</h1><p>Connexion desktop</p></div></div>
    {!active && <div className="ph-scan-idle"><span className="ph-scan-idle-icon"><ScanLine size={30} aria-hidden="true" /></span><h2>Lecteur QR en veille</h2><p>{message}</p><button type="button" className="ph-scan-start theme-toggle" onClick={() => void start()}>Démarrer la caméra QR</button></div>}
    <div className="ph-cam-wrap ph-device-camera" hidden={!active}><div ref={reader} id="ph-device-reader" className="ph-scan-reader ph-h5-reader" />{active && <button type="button" className="ph-cam-close" onClick={stop}>Fermer</button>}</div>
    {active && <p role="status">{message}</p>}
    <p className="ph-device-note">Seuls les QR desktop v2 de ce serveur sont acceptés. La demande doit ensuite être comparée et confirmée ; scanner ne connecte pas l’appareil.</p>
  </section>;
}
