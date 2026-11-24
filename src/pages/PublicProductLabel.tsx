import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Boxes, Tag } from 'lucide-react';
import { getApiBase } from '../config';

interface PublicProductDetail {
  id: number;
  name: string;
  variant_label?: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  price: number;
  currency: string;
  track_inventory: boolean;
  stock_quantity: number | null;
  stock_status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'untracked';
  company_name?: string;
}

function formatPrice(value: number, currency: string): string {
  const num = Number(value || 0);
  const formatted = Number.isInteger(num)
    ? num.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
    : num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency || 'MAD'}`;
}

function formatQty(qty: number | null, unit?: string): string {
  if (qty == null) return 'Non suivi';
  const num = Number.isInteger(qty)
    ? qty.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
    : qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
  return unit ? `${num} ${unit}` : num;
}

function stockBadgeMeta(status: PublicProductDetail['stock_status']): { label: string; bg: string; fg: string; border: string } {
  if (status === 'out_of_stock') {
    return {
      label: 'Rupture de stock',
      bg: 'rgba(239, 68, 68, 0.12)',
      fg: '#dc2626',
      border: 'rgba(239, 68, 68, 0.28)',
    };
  }
  if (status === 'low_stock') {
    return {
      label: 'Stock bas',
      bg: 'rgba(245, 158, 11, 0.14)',
      fg: '#b45309',
      border: 'rgba(245, 158, 11, 0.30)',
    };
  }
  if (status === 'untracked') {
    return {
      label: 'Disponible',
      bg: 'rgba(100, 116, 139, 0.12)',
      fg: '#475569',
      border: 'rgba(100, 116, 139, 0.25)',
    };
  }
  return {
    label: 'En stock',
    bg: 'rgba(16, 185, 129, 0.12)',
    fg: '#047857',
    border: 'rgba(16, 185, 129, 0.28)',
  };
}

export default function PublicProductLabel() {
  const { ref } = useParams<{ ref: string }>();
  const [item, setItem] = useState<PublicProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const cleanRef = String(ref || '').trim();
    if (!cleanRef) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`${getApiBase()}/api/public/product/${encodeURIComponent(cleanRef)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('NOT_FOUND');
        const json = (await res.json().catch(() => null)) as { success?: boolean; data?: PublicProductDetail } | null;
        if (!json?.success || !json?.data) throw new Error('NOT_FOUND');
        if (!cancelled) {
          setItem(json.data as PublicProductDetail);
          try {
            document.title = `${json.data.name || 'Produit'} · Atlas`;
          } catch { /* */ }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItem(null);
          setNotFound(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ref]);

  const badge = item ? stockBadgeMeta(item.stock_status) : null;
  const code = item ? (item.barcode || item.sku || `P${item.id}`) : '';

  return (
    <div
      className="public-product-label-page"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'var(--ac-bg, #f8fafc)',
        color: 'var(--ac-ink, #0f172a)',
        boxSizing: 'border-box',
      }}
    >
      <main
        className="ac-panel"
        style={{
          width: '100%',
          maxWidth: 460,
          borderRadius: 20,
          padding: 24,
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
        }}
      >
        {loading ? (
          <div aria-busy="true" aria-label="Chargement du produit">
            <div className="skeleton" style={{ height: 12, width: '38%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 24, width: '74%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 14, width: '44%', marginBottom: 20 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div className="skeleton" style={{ height: 92, borderRadius: 14 }} />
              <div className="skeleton" style={{ height: 92, borderRadius: 14 }} />
            </div>
          </div>
        ) : notFound || !item ? (
          <div style={{ textAlign: 'center', padding: '12px 4px' }}>
            <AlertCircle size={30} style={{ opacity: 0.7, marginBottom: 10 }} aria-hidden="true" />
            <h1 style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>Produit introuvable</h1>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              Cette étiquette ne correspond à aucun article actif.
            </p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {item.company_name || 'Atlas Commerce'}
                </span>
                {code && (
                  <span
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12,
                      padding: '3px 9px',
                      borderRadius: 999,
                      border: '1px solid var(--ac-line, #e2e8f0)',
                    }}
                  >
                    {code}
                  </span>
                )}
              </div>
              <h1 style={{ margin: 0, fontSize: '1.35rem', lineHeight: 1.25 }}>
                {item.name}
                {item.variant_label ? ` — ${item.variant_label}` : ''}
              </h1>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                gap: 12,
              }}
            >
              <div
                className="ac-metric"
                style={{
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: '1px solid var(--ac-line, #e2e8f0)',
                }}
              >
                <span className="ac-metric-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Tag size={13} aria-hidden="true" /> Prix de vente
                </span>
                <strong className="ac-metric-val" style={{ fontSize: '1.45rem', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPrice(item.price, item.currency)}
                </strong>
                {item.unit ? <span className="ac-metric-meta">Par {item.unit}</span> : null}
              </div>

              <div
                className="ac-metric"
                style={{
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: '1px solid var(--ac-line, #e2e8f0)',
                }}
              >
                <span className="ac-metric-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Boxes size={13} aria-hidden="true" /> Stock
                </span>
                <strong className="ac-metric-val" style={{ fontSize: '1.45rem', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {formatQty(item.stock_quantity, item.unit)}
                </strong>
                {badge && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignSelf: 'flex-start',
                      marginTop: 6,
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: badge.bg,
                      color: badge.fg,
                      border: `1px solid ${badge.border}`,
                    }}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
