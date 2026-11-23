import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, Tags, X } from 'lucide-react';
import { api } from '../api';
import { canSell } from '../auth';
import { FloatingPortal } from './FloatingPortal';
import { buildFallbackLabelSvg, printLabelSvg, type ProductLabelInfo } from '../lib/printProductLabel';

type Props = {
  product: ProductLabelInfo | null;
  onClose: () => void;
};

export default function ProductLabelModal({ product, onClose }: Props) {
  const showPrice = canSell();
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const fallbackSvg = useMemo(
    () => (product ? buildFallbackLabelSvg({ ...product, showPrice }) : ''),
    [product, showPrice],
  );

  useEffect(() => {
    if (!product?.id) {
      setSvgMarkup(fallbackSvg);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSvgMarkup(fallbackSvg);
    api
      .fetchLabelSvg(product.id)
      .then((svg) => {
        if (!cancelled) setSvgMarkup(svg);
      })
      .catch(() => {
        if (!cancelled) setSvgMarkup(fallbackSvg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product, fallbackSvg]);

  if (!product) return null;

  const activeSvg = svgMarkup || fallbackSvg;
  const fileCode = String(product.barcode || product.sku || product.id || 'produit')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'produit';

  const downloadSvg = () => {
    const blob = new Blob([activeSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etiquette-${fileCode}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <FloatingPortal>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal ac-label-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ac-label-modal-title"
          style={{ maxWidth: 440, width: '100%' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tags size={18} aria-hidden="true" />
              <h3 id="ac-label-modal-title" style={{ margin: 0 }}>Étiquette produit</h3>
            </div>
            <button type="button" className="modal-x" aria-label="Fermer" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
            {product.name}
            {loading ? ' · chargement QR…' : ''}
          </p>
          <div
            className="ac-label-preview-box"
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 14,
              border: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 16,
            }}
            dangerouslySetInnerHTML={{ __html: activeSvg }}
          />
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="secondary" onClick={downloadSvg}>
              <Download size={15} aria-hidden="true" /> SVG
            </button>
            <button type="button" onClick={() => printLabelSvg(activeSvg, `Étiquette — ${product.name}`)}>
              <Printer size={15} aria-hidden="true" /> Imprimer
            </button>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}
