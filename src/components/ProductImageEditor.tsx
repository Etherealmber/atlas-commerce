import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Img = { id: number; url: string; is_primary?: number; alt_text?: string };

/* ─── helpers ───────────────────────────────────────────────── */

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Lecture blob impossible'));
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (!img.naturalWidth) reject(new Error('Image vide'));
      else resolve(img);
    };
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

/** Load any src into a clean data: URL (proxy → CDN → fail). */
async function toEditableDataUrl(src: string): Promise<string> {
  if (!src) throw new Error('Aucune image');
  if (src.startsWith('data:image')) return src;

  const errors: string[] = [];
  try {
    const { getApiBase } = await import('../config');
    const base = getApiBase();
    const proxyUrl = `${base}/api/media/proxy?url=${encodeURIComponent(src)}`;
    const res = await fetch(proxyUrl, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'image/*' },
    });
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (!res.ok) {
      let msg = `Proxy HTTP ${res.status}`;
      try {
        const j = await res.clone().json();
        if (j?.error) msg = String(j.error);
      } catch { /* */ }
      throw new Error(msg);
    }
    if (ct.includes('application/json')) {
      const j = await res.json();
      throw new Error(j?.error || 'Proxy JSON');
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error('Proxy vide');
    const typed =
      blob.type && blob.type.startsWith('image/')
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
    return await blobToDataUrl(typed);
  } catch (e: any) {
    errors.push(`proxy: ${e?.message || e}`);
  }

  try {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await blobToDataUrl(await res.blob());
  } catch (e: any) {
    errors.push(`cdn: ${e?.message || e}`);
  }

  throw new Error(`Impossible de charger l’image. ${errors.join(' · ')}`);
}

async function rotateDataUrl(src: string, dir: 1 | -1): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.naturalHeight;
  c.height = img.naturalWidth;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((dir * 90 * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Crop using pixel box in natural image coordinates. */
async function cropDataUrl(
  src: string,
  box: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const img = await loadImage(src);
  const sx = Math.max(0, Math.round(box.x));
  const sy = Math.max(0, Math.round(box.y));
  const sw = Math.max(8, Math.min(img.naturalWidth - sx, Math.round(box.w)));
  const sh = Math.max(8, Math.min(img.naturalHeight - sy, Math.round(box.h)));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/jpeg', 0.9);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 4_000_000) {
      reject(new Error('Image trop lourde (max 4 Mo)'));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Lecture fichier impossible'));
    r.readAsDataURL(file);
  });
}

/* ─── Crop tool (visible frame + handles) ───────────────────── */

type CropBox = { x: number; y: number; w: number; h: number }; // natural image pixels

type DragMode =
  | { kind: 'move'; ox: number; oy: number; start: CropBox }
  | { kind: 'resize'; handle: string; ox: number; oy: number; start: CropBox }
  | null;

/**
 * Full crop tool:
 * - loads image to data URL
 * - shows dimmed overlay + crop rectangle
 * - drag to move, corner/edge handles to resize
 * - Apply / rotate buttons
 */
export function ImageWorkbench({
  src,
  onChange,
  compact,
}: {
  src: string;
  onChange: (next: string) => void;
  compact?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dataSrc, setDataSrc] = useState<string | null>(src.startsWith('data:') ? src : null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [drag, setDrag] = useState<DragMode>(null);
  const [zoom, setZoom] = useState(1);
  const originalSrc = useRef(src);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(!src.startsWith('data:'));

  // Load remote → data URL once
  useEffect(() => {
    let cancelled = false;
    setErr('');
    setCrop(null);
    if (src.startsWith('data:image')) {
      setDataSrc(src);
      setLoading(false);
      return;
    }
    setLoading(true);
    setDataSrc(null);
    void (async () => {
      try {
        const data = await toEditableDataUrl(src);
        if (cancelled) return;
        setDataSrc(data);
        onChange(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Chargement impossible');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNat({ w, h });
    // Default crop = centered 80%
    const cw = Math.round(w * 0.8);
    const ch = Math.round(h * 0.8);
    setCrop({
      x: Math.round((w - cw) / 2),
      y: Math.round((h - ch) / 2),
      w: cw,
      h: ch,
    });
  };

  /** Map display coords → natural pixels (object-fit: contain). */
  const displayMetrics = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !nat.w) {
      return { scale: 1, ox: 0, oy: 0, dw: 0, dh: 0 };
    }
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const scale = Math.min(cw / nat.w, ch / nat.h);
    const dw = nat.w * scale;
    const dh = nat.h * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;
    return { scale, ox, oy, dw, dh };
  }, [nat.w, nat.h]);

  const clientToNatural = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const r = stage.getBoundingClientRect();
    const { scale, ox, oy } = displayMetrics();
    const lx = clientX - r.left - ox;
    const ly = clientY - r.top - oy;
    return {
      x: Math.min(nat.w, Math.max(0, lx / (scale || 1))),
      y: Math.min(nat.h, Math.max(0, ly / (scale || 1))),
    };
  };

  const clampCrop = (b: CropBox): CropBox => {
    let { x, y, w, h } = b;
    w = Math.max(16, Math.min(w, nat.w));
    h = Math.max(16, Math.min(h, nat.h));
    x = Math.max(0, Math.min(x, nat.w - w));
    y = Math.max(0, Math.min(y, nat.h - h));
    return { x, y, w, h };
  };

  const onPointerDown = (e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(mode);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !crop) return;
    const p = clientToNatural(e.clientX, e.clientY);
    if (drag.kind === 'move') {
      const dx = p.x - drag.ox;
      const dy = p.y - drag.oy;
      setCrop(
        clampCrop({
          x: drag.start.x + dx,
          y: drag.start.y + dy,
          w: drag.start.w,
          h: drag.start.h,
        }),
      );
      return;
    }
    // resize
    const { handle, start } = drag;
    let { x, y, w, h } = start;
    const right = start.x + start.w;
    const bottom = start.y + start.h;
    if (handle.includes('w')) {
      x = Math.min(p.x, right - 16);
      w = right - x;
    }
    if (handle.includes('e')) {
      w = Math.max(16, p.x - start.x);
    }
    if (handle.includes('n')) {
      y = Math.min(p.y, bottom - 16);
      h = bottom - y;
    }
    if (handle.includes('s')) {
      h = Math.max(16, p.y - start.y);
    }
    setCrop(clampCrop({ x, y, w, h }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch { /* */ }
    setDrag(null);
  };

  const applyCrop = async () => {
    if (!dataSrc || !crop) return;
    setBusy(true);
    setErr('');
    try {
      const next = await cropDataUrl(dataSrc, crop);
      setDataSrc(next);
      onChange(next);
      // reset crop box on new image
      const img = await loadImage(next);
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      const cw = Math.round(img.naturalWidth * 0.85);
      const ch = Math.round(img.naturalHeight * 0.85);
      setCrop({
        x: Math.round((img.naturalWidth - cw) / 2),
        y: Math.round((img.naturalHeight - ch) / 2),
        w: cw,
        h: ch,
      });
    } catch (e: any) {
      setErr(e?.message || 'Recadrage impossible');
    } finally {
      setBusy(false);
    }
  };

  const applyRotate = async (dir: 1 | -1) => {
    if (!dataSrc) return;
    setBusy(true);
    setErr('');
    try {
      const next = await rotateDataUrl(dataSrc, dir);
      setDataSrc(next);
      onChange(next);
      const img = await loadImage(next);
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      const cw = Math.round(img.naturalWidth * 0.85);
      const ch = Math.round(img.naturalHeight * 0.85);
      setCrop({
        x: Math.round((img.naturalWidth - cw) / 2),
        y: Math.round((img.naturalHeight - ch) / 2),
        w: cw,
        h: ch,
      });
    } catch (e: any) {
      setErr(e?.message || 'Rotation impossible');
    } finally {
      setBusy(false);
    }
  };

  const { scale, ox, oy } = displayMetrics();
  const frame =
    crop && nat.w
      ? {
          left: ox + crop.x * scale,
          top: oy + crop.y * scale,
          width: crop.w * scale,
          height: crop.h * scale,
        }
      : null;

  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
  const handlePos = (h: string, f: { left: number; top: number; width: number; height: number }) => {
    const size = 14;
    const half = size / 2;
    let left = f.left + f.width / 2 - half;
    let top = f.top + f.height / 2 - half;
    if (h.includes('n')) top = f.top - half;
    if (h.includes('s')) top = f.top + f.height - half;
    if (h.includes('w')) left = f.left - half;
    if (h.includes('e')) left = f.left + f.width - half;
    if (h === 'n' || h === 's') left = f.left + f.width / 2 - half;
    if (h === 'e' || h === 'w') top = f.top + f.height / 2 - half;
    const cursor =
      h === 'n' || h === 's'
        ? 'ns-resize'
        : h === 'e' || h === 'w'
          ? 'ew-resize'
          : h === 'nw' || h === 'se'
            ? 'nwse-resize'
            : 'nesw-resize';
    return { left, top, width: size, height: size, cursor };
  };

  const baseW = compact ? 300 : 480;
  const baseH = compact ? 220 : 320;
  return (
    <div className="image-crop-tool">
      <div
        style={{
          overflow: 'auto',
          maxWidth: baseW + 24,
          maxHeight: baseH + 60,
          margin: '0 auto',
          borderRadius: 12,
          background: 'var(--pie-stage-bg, #0a0a0a)',
        }}
      >
      <div
        ref={stageRef}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        title="Double-clic : zoom ×2 / retour ×1"
        style={{
          position: 'relative',
          width: baseW * zoom,
          height: baseH * zoom,
          margin: zoom === 1 ? '0 auto' : undefined,
          background: 'var(--pie-stage-bg, #0a0a0a)',
          borderRadius: 12,
          overflow: 'hidden',
          userSelect: 'none',
          touchAction: 'none',
          border: '1px solid var(--line, #3f3f46)',
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ccc',
              fontSize: 13,
              zIndex: 2,
            }}
          >
            Chargement de l’outil de recadrage…
          </div>
        )}
        {dataSrc && (
          <img loading="lazy" decoding="async"
            ref={imgRef}
            src={dataSrc}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* dim outside crop */}
        {frame && (
          <>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                boxShadow: `inset ${frame.left}px ${frame.top}px 0 0 rgba(0,0,0,0.55),
                  inset ${frame.left - (stageRef.current?.clientWidth || 0)}px ${frame.top}px 0 0 rgba(0,0,0,0.55),
                  inset ${frame.left}px ${frame.top - (stageRef.current?.clientHeight || 0)}px 0 0 rgba(0,0,0,0.55)`,
                pointerEvents: 'none',
              }}
            />
            {/* simpler overlay: dark full + clear window via crop box */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${frame.left}px ${frame.top}px,
                  ${frame.left}px ${frame.top + frame.height}px,
                  ${frame.left + frame.width}px ${frame.top + frame.height}px,
                  ${frame.left + frame.width}px ${frame.top}px,
                  ${frame.left}px ${frame.top}px
                )`,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: frame.left,
                top: frame.top,
                width: frame.width,
                height: frame.height,
                border: '2px solid #e8a317',
                boxSizing: 'border-box',
                cursor: 'move',
                // grid lines
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.25) 1px, transparent 1px)',
                backgroundSize: '33.33% 33.33%',
              }}
              onPointerDown={(e) => {
                if (!crop) return;
                const p = clientToNatural(e.clientX, e.clientY);
                onPointerDown(e, {
                  kind: 'move',
                  ox: p.x,
                  oy: p.y,
                  start: { ...crop },
                });
              }}
            />
            {handles.map((h) => {
              const pos = handlePos(h, frame);
              return (
                <div
                  key={h}
                  style={{
                    position: 'absolute',
                    left: pos.left,
                    top: pos.top,
                    width: pos.width,
                    height: pos.height,
                    background: '#e8a317',
                    border: '2px solid #fff',
                    borderRadius: 3,
                    cursor: pos.cursor,
                    zIndex: 3,
                    boxSizing: 'border-box',
                  }}
                  onPointerDown={(e) => {
                    if (!crop) return;
                    const p = clientToNatural(e.clientX, e.clientY);
                    onPointerDown(e, {
                      kind: 'resize',
                      handle: h,
                      ox: p.x,
                      oy: p.y,
                      start: { ...crop },
                    });
                  }}
                />
              );
            })}
          </>
        )}
      </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center', alignItems: 'center' }}>
        <button type="button" className="secondary" disabled={busy || !dataSrc || zoom <= 1} onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))} title="Zoom arrière">
          −
        </button>
        <span style={{ fontSize: 12, minWidth: 44, textAlign: 'center', color: 'var(--muted, #a1a1aa)' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="secondary" disabled={busy || !dataSrc || zoom >= 4} onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.5) * 10) / 10))} title="Zoom avant">
          +
        </button>
        <button type="button" className="secondary" disabled={busy || !dataSrc || zoom === 1} onClick={() => setZoom(1)}>
          1:1
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !dataSrc}
          title="Revenir à la photo d'origine (annule recadrage/rotation)"
          onClick={() => {
            setCrop(null);
            setZoom(1);
            setDataSrc(originalSrc.current.startsWith('data:') ? originalSrc.current : null);
            if (!originalSrc.current.startsWith('data:')) {
              setLoading(true);
              void (async () => {
                try {
                  const res = await fetch(originalSrc.current);
                  const blob = await res.blob();
                  const fr = new FileReader();
                  fr.onload = () => { setDataSrc(String(fr.result)); setLoading(false); };
                  fr.readAsDataURL(blob);
                } catch { setLoading(false); }
              })();
            }
            onChange(originalSrc.current);
          }}
        >
          ↩ Original
        </button>
        <button type="button" className="secondary" disabled={busy || !dataSrc} onClick={() => void applyRotate(-1)}>
          ↺ 90°
        </button>
        <button type="button" className="secondary" disabled={busy || !dataSrc} onClick={() => void applyRotate(1)}>
          ↻ 90°
        </button>
        <button
          type="button"
          disabled={busy || !dataSrc || !crop}
          onClick={() => void applyCrop()}
          style={{ fontWeight: 600 }}
        >
          {busy ? '…' : 'Appliquer le recadrage'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !nat.w}
          onClick={() => {
            if (!nat.w) return;
            const cw = Math.round(nat.w * 0.8);
            const ch = Math.round(nat.h * 0.8);
            setCrop({
              x: Math.round((nat.w - cw) / 2),
              y: Math.round((nat.h - ch) / 2),
              w: cw,
              h: ch,
            });
          }}
        >
          Réinitialiser cadre
        </button>
      </div>
      {err && <p style={{ fontSize: 12, color: 'var(--bad, #c44)', margin: '8px 0 0' }}>{err}</p>}
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>
        Déplacez le cadre orange · poignées pour redimensionner · puis « Appliquer le recadrage ».
      </p>
    </div>
  );
}

/* ─── Product gallery editor ────────────────────────────────── */

export default function ProductImageEditor({ productId }: { productId: number }) {
  const [images, setImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Img | null>(null);
  const [editSrc, setEditSrc] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.getProductImages(productId);
      setImages(r.data || []);
    } catch (e: any) {
      setErr(e.message || 'Images indisponibles');
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr('');
    try {
      for (const file of Array.from(files)) {
        const data_url = await fileToDataUrl(file);
        await api.addProductImage(productId, {
          data_url,
          is_primary: images.length === 0,
          alt_text: file.name,
        });
      }
      await load();
    } catch (e: any) {
      setErr(e.message || 'Échec ajout image');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (img: Img) => {
    setBusy(true);
    try {
      await api.deleteProductImage(productId, img.id);
      if (edit?.id === img.id) setEdit(null);
      await load();
    } catch (e: any) {
      setErr(e.message || 'Suppression impossible');
    } finally {
      setBusy(false);
    }
  };

  const setPrimary = async (img: Img) => {
    setBusy(true);
    try {
      await api.updateProductImage(productId, img.id, { is_primary: true });
      await load();
    } catch (e: any) {
      setErr(e.message || 'Impossible de définir la photo principale');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    if (!editSrc.startsWith('data:')) {
      setErr('Appliquez d’abord un recadrage ou une rotation.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.updateProductImage(productId, edit.id, {
        data_url: editSrc,
        is_primary: !!edit.is_primary,
      });
      setEdit(null);
      await load();
    } catch (e: any) {
      setErr(e.message || 'Enregistrement image impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="product-image-editor"
      style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line, #e0d9cc)' }}
    >
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Photos produit</h3>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        Ajoutez, recadrez, tournez ou supprimez. La photo principale sert au catalogue / boutique.
      </p>
      {err && <p style={{ color: 'var(--bad)', fontSize: 12 }}>{err}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        {images.map((img) => (
          <div
            key={img.id}
            style={{
              width: 92,
              borderRadius: 10,
              overflow: 'hidden',
              border: img.is_primary ? '2px solid var(--pie-ring, #e8a317)' : '1px solid var(--pie-thumb-border, #d4d4d8)',
              background: 'var(--pie-thumb-bg, #faf9f6)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setEdit(img);
                setEditSrc(img.url);
              }}
              style={{ display: 'block', padding: 0, border: 0, background: 'none', width: '100%' }}
            >
              <img loading="lazy" decoding="async"
                src={img.url}
                alt=""
                style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }}
              />
            </button>
            <div style={{ display: 'flex', fontSize: 10 }}>
              <button
                type="button"
                className="secondary"
                style={{ flex: 1, padding: '3px 0', fontSize: 10 }}
                disabled={busy || !!img.is_primary}
                onClick={() => setPrimary(img)}
              >
                {img.is_primary ? '★ Principale' : 'Définir'}
              </button>
              <button
                type="button"
                className="danger"
                style={{ padding: '3px 6px', fontSize: 10 }}
                disabled={busy}
                onClick={() => void remove(img)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <label
          style={{
            width: 92,
            height: 96,
            borderRadius: 10,
            border: '1px dashed var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: 'var(--muted)',
            cursor: busy ? 'wait' : 'pointer',
            textAlign: 'center',
            padding: 6,
          }}
        >
          {busy ? '…' : '+ Ajouter'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {edit && (
        <div className="modal-overlay" onClick={() => !busy && setEdit(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Modifier la photo — outil de recadrage</h3>
            <ImageWorkbench src={editSrc} onChange={setEditSrc} />
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" disabled={busy} onClick={() => setEdit(null)}>
                Fermer
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => void remove(edit)}>
                Supprimer
              </button>
              <button type="button" disabled={busy} onClick={() => void saveEdit()}>
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
