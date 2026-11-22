/** Only show identities actually recorded by the server; no guessed approver. */
export default function DocumentActors({ document }: { document: { created_by?: string | null; approved_by?: string | null } }) {
  if (!document.created_by && !document.approved_by) return null;
  return <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
    {document.created_by && <span>Créé par : {document.created_by}</span>}
    {document.created_by && document.approved_by && ' · '}
    {document.approved_by && <span>Approuvé par : {document.approved_by}</span>}
  </div>;
}
