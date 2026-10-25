import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import './ImageAnnotator.css';

type Tool = 'pen' | 'text';

export type ImageAnnotatorProps = {
  src: string;
  name: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
};

const SWATCHES = ['#b87333', '#18181b', '#fafafa', '#dc2626', '#2563eb', '#16a34a'];

/**
 * ImageAnnotator — light canvas editor for attached images:
 * freehand pen, text notes (click where the note should land),
 * color swatches, stroke size, undo, reset, save.
 */
export const ImageAnnotator: FC<ImageAnnotatorProps> = ({ src, name, onSave, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(SWATCHES[0]);
  const [size, setSize] = useState(3);
  const [ready, setReady] = useState(false);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textVal, setTextVal] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !textAt) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, textAt]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxW = 760;
      const maxH = 460;
      let scale = Math.min(maxW / img.width, maxH / img.height);
      if (img.width * scale < 320) scale = Math.min(320 / img.width, maxH / img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      imgRef.current = img;
      history.current = [];
      setReady(true);
    };
    img.src = src;
  }, [src]);

  const ctx2d = () => canvasRef.current?.getContext('2d') || null;

  const pushHistory = () => {
    const canvas = canvasRef.current;
    const ctx = ctx2d();
    if (!canvas || !ctx) return;
    history.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.current.length > 25) history.current.shift();
    setDirty(true);
  };

  const pt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvasRef.current!.width, y: ((e.clientY - r.top) / r.height) * canvasRef.current!.height };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ready) return;
    const p = pt(e);
    if (tool === 'text') { setTextAt(p); setTextVal(''); return; }
    pushHistory();
    drawing.current = true;
    lastPt.current = p;
    const ctx = ctx2d();
    if (ctx) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = color; ctx.lineWidth = size;
      ctx.beginPath(); ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || tool !== 'pen') return;
    const ctx = ctx2d();
    const p = pt(e);
    if (!ctx || !lastPt.current) return;
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(lastPt.current.x, lastPt.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastPt.current = p;
  };
  const onUp = () => { drawing.current = false; lastPt.current = null; };

  const commitText = () => {
    if (!textAt) return;
    const val = textVal.trim();
    setTextAt(null);
    if (!val) return;
    pushHistory();
    const ctx = ctx2d();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const fs = Math.max(14, Math.round(canvas.width / 34));
    ctx.font = `600 ${fs}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textBaseline = 'top';
    const w = ctx.measureText(val).width;
    ctx.fillStyle = 'rgba(24,24,27,0.72)';
    const pad = 6;
    const bx = Math.min(Math.max(2, textAt.x), canvas.width - w - pad * 2 - 2);
    const by = Math.min(Math.max(2, textAt.y), canvas.height - fs - pad * 2 - 2);
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(bx, by, w + pad * 2, fs + pad * 2, 6);
    else ctx.rect(bx, by, w + pad * 2, fs + pad * 2);
    ctx.fill();
    ctx.fillStyle = color === '#18181b' ? '#fafafa' : color;
    ctx.fillText(val, bx + pad, by + pad);
    setTextVal('');
  };

  const undo = () => {
    const prev = history.current.pop();
    const ctx = ctx2d();
    if (prev && ctx) ctx.putImageData(prev, 0, 0);
    setDirty(history.current.length > 0);
  };

  const reset = () => {
    const canvas = canvasRef.current;
    const ctx = ctx2d();
    if (!canvas || !ctx || !imgRef.current) return;
    pushHistory();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'));
    onClose();
  };

  return createPortal(
    <div className="ia-overlay" role="dialog" aria-modal="true" aria-label={`Annoter ${name}`} onClick={onClose}>
      <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ia-head">
          <strong>Annoter l’image</strong>
          <span className="ia-name" title={name}>{name}</span>
          <button type="button" className="modal-x modal-close" aria-label="Fermer" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="ia-tools" role="toolbar" aria-label="Outils d’annotation">
          <button type="button" className={tool === 'pen' ? 'on' : undefined} onClick={() => setTool('pen')} title="Dessiner">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /></svg>
            Dessiner
          </button>
          <button type="button" className={tool === 'text' ? 'on' : undefined} onClick={() => setTool('text')} title="Note texte">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
            Texte
          </button>
          <span className="ia-sep" aria-hidden />
          {SWATCHES.map((c) => (
            <button key={c} type="button" className={`ia-swatch${color === c ? ' on' : ''}`} style={{ '--sw': c } as any} aria-label={`Couleur ${c}`} onClick={() => setColor(c)} />
          ))}
          <span className="ia-sep" aria-hidden />
          <button type="button" className={size === 2 ? 'on' : undefined} onClick={() => setSize(2)} title="Trait fin">S</button>
          <button type="button" className={size === 4 ? 'on' : undefined} onClick={() => setSize(4)} title="Trait moyen">M</button>
          <button type="button" className={size === 8 ? 'on' : undefined} onClick={() => setSize(8)} title="Trait épais">L</button>
          <span className="ia-spacer" />
          <button type="button" onClick={undo} disabled={history.current.length === 0} title="Annuler le dernier trait">Annuler</button>
          <button type="button" onClick={reset} title="Réinitialiser l’image">Réinitialiser</button>
        </div>
        <div className="ia-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className={tool === 'text' ? 'ia-canvas ia-canvas--text' : 'ia-canvas'}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          {textAt && (
            <input
              className="ia-text-input"
              autoFocus
              placeholder="Votre note… (Entrée pour placer)"
              value={textVal}
              style={{ left: `${(textAt.x / (canvasRef.current?.width || 1)) * 100}%`, top: `${(textAt.y / (canvasRef.current?.height || 1)) * 100}%` }}
              onChange={(e) => setTextVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { e.stopPropagation(); setTextAt(null); } }}
              onBlur={commitText}
            />
          )}
          {!ready && <span className="ia-loading">Chargement…</span>}
        </div>
        <div className="ia-foot">
          <span className="ia-hint">{tool === 'pen' ? 'Dessinez directement sur l’image.' : 'Cliquez sur l’image pour placer une note texte.'}</span>
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="btn secondary" disabled={!dirty} onClick={save}>Enregistrer l’image annotée</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImageAnnotator;
