import { Table2 } from 'lucide-react';

type Trace = { name: string; ok?: boolean; data?: unknown };
type Column = { key: string; label: string };
const DEFINITIONS: Record<string, { title: string; columns: Column[] }> = {
  list_unpaid_invoices: { title: 'Factures impayées', columns: [{ key: 'number', label: 'Numéro' }, { key: 'client_name', label: 'Client' }, { key: 'total', label: 'Total' }, { key: 'amount_paid', label: 'Payé' }, { key: 'status', label: 'Statut' }] },
  list_recent_invoices: { title: 'Factures récentes', columns: [{ key: 'number', label: 'Numéro' }, { key: 'client_name', label: 'Client' }, { key: 'total', label: 'Total' }, { key: 'status', label: 'Statut' }] },
  list_open_quotes: { title: 'Devis ouverts', columns: [{ key: 'number', label: 'Numéro' }, { key: 'client_name', label: 'Client' }, { key: 'total', label: 'Total' }, { key: 'status', label: 'Statut' }] },
  list_low_stock: { title: 'Stocks bas', columns: [{ key: 'name', label: 'Produit' }, { key: 'sku', label: 'SKU' }, { key: 'stock_quantity', label: 'Stock' }, { key: 'low_stock_threshold', label: 'Seuil' }] },
  search_products: { title: 'Produits trouvés', columns: [{ key: 'name', label: 'Produit' }, { key: 'sku', label: 'SKU' }, { key: 'stock_quantity', label: 'Stock' }] },
  search_clients: { title: 'Clients trouvés', columns: [{ key: 'name', label: 'Client' }, { key: 'city', label: 'Ville' }] },
};
function scalar(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 160) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}
/** Only display known fields from a successful, real tool response. */
export function AgentToolResults({ tools }: { tools: Trace[] }) {
  return <>{tools.map((tool, index) => {
    const definition = DEFINITIONS[tool.name];
    if (!definition || tool.ok !== true) return null;
    const data = tool.data;
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as any).items) ? (data as any).items : null;
    if (!rows || rows.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))) return null;
    return <details className="atlas-agent-result-card" key={`${tool.name}-${index}`}>
      <summary><span className="atlas-agent-result-icon"><Table2 size={16} aria-hidden="true" /></span><span><strong>{definition.title}</strong><small>{rows.length} résultat{rows.length === 1 ? '' : 's'} renvoyé{rows.length === 1 ? '' : 's'} · données au moment de la réponse</small></span><span className="atlas-agent-result-view">Voir</span></summary>
      {rows.length ? <div className="atlas-agent-result-table"><table><thead><tr>{definition.columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.slice(0, 20).map((row: Record<string, unknown>, i: number) => <tr key={i}>{definition.columns.map(column => <td key={column.key}>{scalar(row[column.key])}</td>)}</tr>)}</tbody></table>{rows.length > 20 && <p>20 premières lignes affichées.</p>}</div> : <p>Aucun résultat renvoyé par cet outil.</p>}
    </details>;
  })}</>;
}
