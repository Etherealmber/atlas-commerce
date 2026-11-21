import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { getBase } from '../api';
import { getToken } from '../auth';
import { getCachedFingerprint } from '../fingerprint';
import PhoneDialog from './PhoneDialog';
import { readReportBytes } from './reportResponse';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

const MAX_BYTES = 20 * 1024 * 1024;

/** Render only pages near the viewport, releasing their canvases after scrolling away. */
function PdfPage({ doc, page, zoom, container, containerWidth, onError }: { doc: any; page: number; zoom: number; container: HTMLDivElement | null; containerWidth: number; onError: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false); const [height, setHeight] = useState<number | undefined>();
  useEffect(() => {
    if (!container || !wrapper.current) return;
    const el = wrapper.current;
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { root: container, rootMargin: '500px 0px' });
      observer.observe(el); return () => observer.disconnect();
    }
    const check = () => { const r = el.getBoundingClientRect(), c = container.getBoundingClientRect(); setVisible(r.bottom >= c.top - 500 && r.top <= c.bottom + 500); };
    check(); container.addEventListener('scroll', check, { passive: true }); window.addEventListener('resize', check);
    return () => { container.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [container]);
  useEffect(() => {
    if (!visible || !container || !canvas.current) return;
    let cancelled = false; let task: any;
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.max(240, (containerWidth || container.clientWidth) - 24);
        const viewport = pdfPage.getViewport({ scale: Math.min(2600 / base.width, 3600 / base.height, width * zoom / base.width) });
        const el = canvas.current; const context = el.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        const pixelScale = Math.min(window.devicePixelRatio || 1, 2, 2600 / viewport.width, 3600 / viewport.height);
        el.width = Math.ceil(viewport.width * pixelScale); el.height = Math.ceil(viewport.height * pixelScale);
        el.style.width = `${viewport.width}px`; el.style.height = `${viewport.height}px`; setHeight(viewport.height);
        task = pdfPage.render({ canvasContext: context, viewport, transform: pixelScale === 1 ? undefined : [pixelScale, 0, 0, pixelScale, 0, 0] }); await task.promise;
      } catch { if (!cancelled) onError(); }
    })();
    return () => { cancelled = true; task?.cancel(); if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; } };
  }, [doc, page, zoom, visible, container, containerWidth, onError]);
  return <div className="ph-pdf-page" ref={wrapper} style={{ minHeight: height || `${Math.round(Math.SQRT2 * zoom * 100)}vw` }}><canvas ref={canvas} aria-label={`Page ${page} du rapport`} /><span>Page {page}</span></div>;
}

/** In-memory monthly PDF viewer: no tickets or bearer in the URL and no persistent cache. */
export default function PhoneMonthlyReport({ period, onClose }: { period: string; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null); const [doc, setDoc] = useState<any>(null);
  const [zoom, setZoom] = useState(1); const [error, setError] = useState('');
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  useEffect(() => {
    if (!frame) return;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(frame); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [frame]);
  const setRenderError = useCallback(() => setError('Impossible d’afficher cette page. Fermez puis rouvrez le rapport.'), []);
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false; let task: any;
    (async () => {
      try {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Période invalide.');
        const token = getToken(); if (!token) throw new Error('Session expirée.');
        const fingerprint = await getCachedFingerprint(); if (cancelled) return;
        const response = await fetch(`${getBase()}/api/admin/finance/monthly/report.pdf?${new URLSearchParams({ period })}`, { headers: { Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': fingerprint, Accept: 'application/pdf' }, redirect: 'error', cache: 'no-store', signal: controller.signal });
        if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('application/pdf')) throw new Error('Rapport PDF indisponible.');
        const bytes = await readReportBytes(response, MAX_BYTES); if (cancelled) return;
        const pdf = new Blob([bytes as BlobPart], { type: 'application/pdf' });
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        if (cancelled) return;
        task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true });
        const document = await task.promise; if (cancelled) return;
        if (document.numPages > 500) throw new Error('Rapport trop volumineux pour la lecture mobile.');
        setBlob(pdf); setDoc(document);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Impossible de lire le rapport.'); }
    })();
    return () => { cancelled = true; controller.abort(); if (task) void task.destroy(); };
  }, [period]);
  const save = () => { if (!blob) return; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `releve-${period}.pdf`; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); };
  const share = async () => { if (!blob) return; const file = new File([blob], `releve-${period}.pdf`, { type: 'application/pdf' }); if (!navigator.canShare?.({ files: [file] }) || !navigator.share) { setError('Partage indisponible sur ce navigateur. Enregistrez une copie.'); return; } try { await navigator.share({ files: [file], title: 'Rapport mensuel' }); } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setError('Partage du PDF impossible.'); } };
  return <PhoneDialog titleId="phone-pdf-title" onClose={onClose} className="ph-report-modal"><div className="ph-report-viewer">
    <header className="ph-report-header"><button type="button" onClick={onClose} aria-label="Fermer le rapport"><X size={20} /></button><div><h2 id="phone-pdf-title">Rapport mensuel · PDF</h2><small>{doc ? `${doc.numPages} page(s) · lecture dans Atlas` : 'Ouverture du document…'}</small></div><button type="button" onClick={() => void share()} disabled={!blob} aria-label="Partager le PDF"><Share2 size={20} /></button><button type="button" onClick={save} disabled={!blob} aria-label="Enregistrer une copie"><Download size={20} /></button></header>
    {doc && <div className="ph-report-controls"><button type="button" aria-label="Réduire le zoom" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - .25))}><ZoomOut size={18} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Agrandir le PDF" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + .25))}><ZoomIn size={18} /></button></div>}
    {error && <p className="ph-report-error" role="alert">{error}</p>}
    <div className="ph-report-paper" ref={setFrame}>{!doc && !error && <p role="status">Chargement du rapport…</p>}{doc && Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={`${i}-${zoom}`} doc={doc} page={i + 1} zoom={zoom} container={frame} containerWidth={frameWidth} onError={setRenderError} />)}</div>
  </div></PhoneDialog>;
}
