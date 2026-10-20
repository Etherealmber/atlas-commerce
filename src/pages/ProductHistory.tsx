import { useEffect, useState } from 'react';
import { ListPager } from '../components/ui/ListPager';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import RefreshIconButton from '../components/RefreshIconButton';

const TYPE_FR: Record<string, string> = {
  in: 'Entrée',
  out: 'Sortie',
  sale: 'Vente',
  adjust: 'Ajustement',
  transfer: 'Transfert',
  return: 'Retour',
};

export default function ProductHistory() {
  const { id } = useParams();
  const productId = Number(id);
  const [rows, setRows] = useState<any[]>([]);
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const load = async () => {
    if (!productId) return;
    setLoading(true);
    setErr('');
    try {
      const [mov, prod] = await Promise.all([
        api.getProductMovements(productId, 1000, { full: true }),
        api.getProduct?.(productId).catch(() => null) ??
          api.getProducts?.().then((r: any) => ({ data: (r.data || []).find((p: any) => Number(p.id) === productId) })),
      ]);
      setRows(Array.isArray(mov.data) ? mov.data : []);
      const p = (prod as any)?.data;
      setProduct(p && !Array.isArray(p) ? p : p);
    } catch (e: any) {
      setErr(e?.message || 'Chargement impossible');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [productId]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const title = product?.name ? `${product.name}` : `Produit #${productId}`;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ marginBottom: 4 }}>Historique stock</h1>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {title}
            {product?.sku ? ` · SKU ${product.sku}` : ''}
            {!loading ? ` · ${rows.length} mouvement${rows.length !== 1 ? 's' : ''} (tout l’historique)` : ''}
          </p>
        </div>
        <RefreshIconButton onClick={() => load()} loading={loading} />
        <Link to="/products" className="secondary" style={{ textDecoration: 'none', padding: '8px 14px' }}>
          ← Produits
        </Link>
      </div>

      {err ? (
        <div className="modal-form-alert modal-form-alert--error" style={{ marginBottom: 16 }}>
          {err}
        </div>
      ) : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty" style={{ padding: 24 }}>
            Chargement…
          </div>
        ) : rows.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            Aucun mouvement enregistré pour ce produit.
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Qté</th>
                    <th>Avant</th>
                    <th>Après</th>
                    <th>Raison</th>
                    <th>Réf.</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((m: any) => (
                    <tr key={m.id || `${m.created_at}-${m.new_quantity}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{String(m.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                      <td>{TYPE_FR[m.type] || m.type || '—'}</td>
                      <td>{m.quantity}</td>
                      <td>{m.previous_quantity}</td>
                      <td>
                        <strong>{m.new_quantity}</strong>
                      </td>
                      <td>{m.reason || '—'}</td>
                      <td>{m.reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > pageSize ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 12, borderTop: '1px solid #e8eaef' }}>
                <ListPager page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} pageBase={1} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
