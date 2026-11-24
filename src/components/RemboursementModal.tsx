import { FloatingPortal } from './FloatingPortal';
import { useWizard, StepBody, WizardFoot, WizardHeader, WizardIntro, type WizardStepDef } from './ui/FormWizard';
import { ModalFormError } from './ModalFormFeedback';
import { useEffect, useState } from 'react';
import { api } from '../api';
import NumberField from './NumberField';
import { statusFr } from '../lib/labels';
import { fmtMoney } from '../lib/money';
import { useUi } from './AppDialogs';
import { friendlyError } from '../lib/errors';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /** Prefer VR tickets when opened from Quick Sale */
  preferQuickSale?: boolean;
  /** Pre-select a source invoice / ticket ID and open directly on step 2 */
  initialSourceId?: number;
};

const WR_STEPS: readonly WizardStepDef[] = [
  { id: 'source', label: 'Document d’origine', hint: 'Choisissez la facture FA ou le ticket VR concerné.' },
  { id: 'lines', label: 'Lignes & motif', hint: 'Quantités remboursées, retour en stock et explication.' },
];

const REASON_CODES = [
  { value: 'error_us', label: 'Erreur de notre part' },
  { value: 'defective', label: 'Article cassé / défectueux (non causé par le client)' },
  { value: 'wrong_item', label: 'Mauvais article' },
  { value: 'missing_qty', label: 'Quantité manquante' },
  { value: 'transport', label: 'Dommage transport' },
];

/**
 * Shared WR create dialog — used from Factures, Vente rapide, Remboursements.
 */
export default function RemboursementModal({ open, onClose, onCreated, preferQuickSale, initialSourceId }: Props) {
  const { confirm, toast } = useUi();
  const [sources, setSources] = useState<any[]>([]);
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [source, setSource] = useState<any>(null);
  const [lines, setLines] = useState<
    {
      invoice_item_id: number;
      product_name: string;
      max_qty: number;
      already_refunded: number;
      quantity: number;
      unit_price: number;
      restock: boolean;
      disposition: string;
    }[]
  >([]);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const wz = useWizard(2);
  const [err, setErr] = useState('');

  const fmt = (n: number) => fmtMoney(n, 'MAD');

  const buildLines = async (data: any) => {
    const prior = await api.getInvoices('remboursement', { kind: 'all' }).catch(() => ({ data: [] }));
    const related = (prior.data || []).filter(
      (x: any) => Number(x.refund_of_invoice_id) === Number(data.id),
    );
    const refundedMap = new Map<number, number>();
    for (const wr of related) {
      try {
        const full = await api.getInvoice(wr.id);
        for (const it of full.data?.items || []) {
          const m = String(it.sku || it.notes || '').match(/src_item:(\d+)/);
          const key = m ? Number(m[1]) : Number(it.product_id || 0);
          if (key) refundedMap.set(key, (refundedMap.get(key) || 0) + Number(it.quantity || 0));
        }
      } catch {
        /* */
      }
    }
    return (data.items || []).map((it: any) => {
      const already = refundedMap.get(Number(it.id)) || refundedMap.get(Number(it.product_id || 0)) || 0;
      const maxQty = Math.max(0, Number(it.quantity || 0) - already);
      return {
        invoice_item_id: it.id,
        product_name: it.product_name,
        max_qty: maxQty,
        already_refunded: already,
        quantity: maxQty,
        unit_price: Number(it.unit_price || 0),
        restock: true,
        disposition: '',
      };
    });
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSourceId(initialSourceId || '');
    setSource(null);
    setLines([]);
    setReasonCode('');
    setReasonDetail('');
    setPayMethod('cash');
    setErr('');
    wz.go(initialSourceId ? 2 : 1);
    void (async () => {
      try {
        const [all, qs] = await Promise.all([
          api.getInvoices(undefined, { kind: 'all' }).catch(() => ({ data: [] })),
          api.getInvoices(undefined, { kind: 'quick_sale' }).catch(() => ({ data: [] })),
        ]);
        const map = new Map<number, any>();
        for (const inv of [...(all.data || []), ...(qs.data || [])]) {
          if (inv?.id == null) continue;
          const st = String(inv.status || '');
          const kind = String(inv.doc_kind || '');
          // Paid FA / VR are allowed — WR still applies (cash refund to Solde)
          if (st === 'quote' || st === 'devis' || st === 'cancelled' || st === 'remboursement') continue;
          if (kind === 'remboursement') continue;
          map.set(inv.id, inv);
        }
        let list = Array.from(map.values());
        if (preferQuickSale) {
          list = list.sort((a, b) => {
            const av = a.doc_kind === 'quick_sale' || String(a.number || '').startsWith('VR') ? 0 : 1;
            const bv = b.doc_kind === 'quick_sale' || String(b.number || '').startsWith('VR') ? 0 : 1;
            return av - bv;
          });
        }
        if (!cancelled) setSources(list);
        if (initialSourceId) {
          const det = await api.getInvoice(initialSourceId);
          if (!cancelled && det?.data) {
            setSource(det.data);
            setLines(await buildLines(det.data));
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Impossible de charger les documents');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, preferQuickSale, initialSourceId]);

  const submitWr = async () => {
              if (!sourceId) {
                setErr('Choisissez le document d’origine.');
                return;
              }
              if (!reasonCode) {
                setErr('Sélectionnez un motif valable.');
                return;
              }
              if (reasonDetail.trim().length < 12) {
                setErr('Explication trop courte (min. 12 caractères).');
                return;
              }
              const active = lines.filter((l) => Number(l.quantity) > 0);
              if (!active.length) {
                setErr('Indiquez au moins une quantité à rembourser.');
                return;
              }
              for (const l of active) {
                if (!l.restock && !l.disposition) {
                  setErr(`Disposition obligatoire pour « ${l.product_name} ».`);
                  return;
                }
              }
              const restockCount = active.filter((l) => l.restock).length;
              const ok = await confirm({
                title: 'Confirmer le remboursement WR',
                message: `Créer un avoir WR ?\n• ${restockCount} ligne(s) → retour stock\n• ${active.length - restockCount} hors stock`,
                confirmLabel: 'Créer l’avoir WR',
                cancelLabel: 'Retour',
              });
              if (!ok) return;
              setSaving(true);
              setErr('');
              try {
                const res: any = await api.createRemboursement({
                  refund_of_invoice_id: sourceId,
                  refund_reason_code: reasonCode,
                  refund_payment_method: payMethod,
                  refund_reason: reasonDetail.trim(),
                  items: active.map((l) => ({
                    invoice_item_id: l.invoice_item_id,
                    quantity: l.quantity,
                    restock: l.restock,
                    disposition: l.restock ? undefined : l.disposition,
                  })),
                });
                const msg = res.message || `Avoir ${res.data?.number || 'WR'} créé.`;
                toast(msg, 'success');
                onCreated?.();
                onClose();
              } catch (e: any) {
                const msg = friendlyError(e, 'Impossible de créer le remboursement.');
                setErr(msg);
              } finally {
                setSaving(false);
              }
  };

  if (!open) return null;

  return (
    <FloatingPortal><div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal step-wizard" role="dialog" aria-modal="true" aria-labelledby="wr-wizard-title" onClick={(e) => e.stopPropagation()}>
        <WizardHeader eyebrow="AVOIR / RETOUR" title="Créer un remboursement (WR)" titleId="wr-wizard-title" wz={wz} steps={WR_STEPS} />
        <div className="step-wizard__body">
        <WizardIntro step={WR_STEPS[wz.step - 1]} />
        <StepBody active={wz.step === 1}>
        <div
          className="modal-note modal-note--warn"
          style={{
            padding: '10px 12px',
          }}
        >
          <strong>Numérotation WR-</strong> — distincte des tickets <strong>VR-</strong>. Motifs acceptés : erreur de
          notre part, article défectueux, mauvais article, quantité manquante, dommage transport.
        </div>

        <div className="form-row">
          <label>Document d’origine *</label>
          <select
            value={sourceId}
            disabled={saving}
            onChange={async (e) => {
              const id = e.target.value ? Number(e.target.value) : '';
              setSourceId(id);
              setSource(null);
              setLines([]);
              setErr('');
              if (!id) return;
              try {
                const res = await api.getInvoice(id);
                setSource(res.data);
                setLines(await buildLines(res.data));
              } catch (ex: any) {
                setErr(ex?.message || 'Chargement impossible');
              }
            }}
          >
            <option value="">— Choisir FA ou ticket VR —</option>
            {sources.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.number}
                {inv.doc_kind === 'quick_sale' || String(inv.number || '').startsWith('VR') ? ' [VR]' : ' [FA]'}
                {' — '}
                {inv.client_name} — {fmt(Number(inv.total || 0))}
                {Number(inv.amount_paid || 0) >= Number(inv.total || 0) - 0.001 ? ' · payé' : ''}
              </option>
            ))}
          </select>
        </div>

        </StepBody>
        <StepBody active={wz.step === 2}>
        {source && (
          <>
            <p style={{ fontSize: 13, marginBottom: 8 }}>
              Client : <strong>{source.client_name}</strong> · Statut : {statusFr(source.status)} · Payé{' '}
              {fmt(Number(source.amount_paid || 0))} / {fmt(Number(source.total || 0))}
            </p>
            {Number(source.amount_paid || 0) + 0.001 >= Number(source.total || 0) || source.status === 'paid' ? (
              <p className="modal-note modal-note--ok">
                Document déjà payé — le WR créera une <strong>sortie de solde</strong> (remboursement client). Stock ajusté selon les lignes.
              </p>
            ) : Number(source.amount_paid || 0) > 0.001 ? (
              <p className="modal-note modal-note--warn">
                Partiellement payé — crédit sur le reste dû + sortie de solde pour la part déjà encaissée.
              </p>
            ) : (
              <p className="modal-note modal-note--warn">
                Non payé — le WR s’applique en crédit sur le reste dû (pas de sortie caisse).
              </p>
            )}
            <h3 style={{ fontSize: 14, margin: '8px 0 6px' }}>Lignes à rembourser</h3>
            <div
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                display: 'grid',
                gridTemplateColumns: '1.2fr 56px 72px 88px 1fr',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span>Article</span>
              <span>Max</span>
              <span>Qté</span>
              <span>Stock</span>
              <span>Disposition si hors stock</span>
            </div>
            {lines.map((line, idx) => (
              <div
                key={line.invoice_item_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 56px 72px 88px 1fr',
                  gap: 6,
                  marginBottom: 8,
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 13 }}>
                  {line.product_name}
                  {line.already_refunded > 0 && (
                    <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                      {' '}
                      (déjà remboursé {line.already_refunded} — reste {line.max_qty})
                    </span>
                  )}
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>
                    {fmt(line.unit_price)} / u
                  </span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{line.max_qty}</span>
                <NumberField
                  min={0}
                  max={line.max_qty}
                  step="0.01"
                  value={line.quantity}
                  disabled={saving}
                  onValueChange={(v) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], quantity: Math.min(Math.max(0, v), line.max_qty) };
                    setLines(next);
                  }}
                />
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={line.restock}
                    disabled={saving}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], restock: e.target.checked };
                      setLines(next);
                    }}
                  />
                  Retour
                </label>
                <select
                  value={line.disposition}
                  disabled={saving || line.restock}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], disposition: e.target.value };
                    setLines(next);
                  }}
                >
                  <option value="">—</option>
                  <option value="broken">Cassé</option>
                  <option value="lost">Perdu</option>
                  <option value="other">Autre</option>
                </select>
              </div>
            ))}
          </>
        )}

        <div className="grid grid-2">
        <div className="form-row">
          <label>Motif *</label>
          <select value={reasonCode} onChange={(e) => { setReasonCode(e.target.value); if (err) setErr(''); }} disabled={saving}>
            <option value="">— Choisir —</option>
            {REASON_CODES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Mode de remboursement (si payé)</label>
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={saving}>
            <option value="cash">Espèces (caisse)</option>
            <option value="card">Carte</option>
            <option value="transfer">Virement</option>
            <option value="cheque">Chèque</option>
            <option value="other">Autre</option>
          </select>
        </div>
        </div>
        <div className="form-row">
          <label>Explication détaillée *</label>
          <textarea
            rows={2}
            value={reasonDetail}
            onChange={(e) => { setReasonDetail(e.target.value); if (err) setErr(''); }}
            disabled={saving}
            placeholder="Min. 12 caractères — description claire du problème"
          />
        </div>

        </StepBody>
        <ModalFormError message={err} />
        </div>
            <WizardFoot
              title="Remboursement (WR)"
              wz={wz}
              stepLabel={WR_STEPS[wz.step - 1].label}
              onCancel={() => !saving && onClose()}
              onBack={() => setErr('')}
              onNext={() => {
                if (wz.step === 1 && (!sourceId || !source)) {
                  setErr('Choisissez une facture ou un ticket VR d’origine.');
                  return false;
                }
                setErr('');
                return true;
              }}
              onSubmit={() => void submitWr()}
              submitLabel={saving ? 'Création…' : 'Créer le remboursement'}
              saving={saving}
            />
      </div>
    </div></FloatingPortal>
  );
}
