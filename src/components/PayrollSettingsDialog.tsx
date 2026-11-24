import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import { FloatingPortal } from './FloatingPortal';

type Rates = Record<string, number | string | undefined>;

/** Same fields, defaults and steps as Paramètres → Paie CNSS / AMO. */
const FIELDS: { key: string; label: string; step: string; fallback: number }[] = [
  { key: 'cnss_emp_rate', label: 'CNSS salarié (taux, ex: 0.0448 = 4,48 %)', step: '0.0001', fallback: 0.0448 },
  { key: 'cnss_ceiling', label: 'Plafond CNSS mensuel (MAD)', step: '1', fallback: 6000 },
  { key: 'cnss_employer_social_rate', label: 'CNSS patronale sociale plafonnée (ex: 0.0898)', step: '0.0001', fallback: 0.0898 },
  { key: 'cnss_employer_af_rate', label: 'CNSS patronale AF non plafonnée (ex: 0.064)', step: '0.0001', fallback: 0.064 },
  { key: 'cnss_employer_tfp_rate', label: 'TFP formation prof. employeur (ex: 0.016)', step: '0.0001', fallback: 0.016 },
  { key: 'amo_emp_rate', label: 'AMO salarié (ex: 0.0226 = 2,26 %)', step: '0.0001', fallback: 0.0226 },
  { key: 'amo_employer_rate', label: 'AMO patronale + solidarité (ex: 0.0411)', step: '0.0001', fallback: 0.0411 },
  { key: 'prof_expenses_rate', label: 'Frais professionnels (taux, ex: 0.25 = 25 %)', step: '0.01', fallback: 0.25 },
  { key: 'prof_expenses_monthly_cap', label: 'Plafond mensuel frais prof. (MAD)', step: '0.01', fallback: 2916.67 },
];

export default function PayrollSettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .getPayrollSettings()
      .then((r) => { if (alive) setRates(r.data || {}); })
      .catch((e: any) => { if (alive) setError(e?.message || 'Chargement des taux impossible.'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (rates) dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [rates]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!rates) return;
    setSaving(true);
    setError('');
    try {
      await api.updatePayrollSettings(rates);
      onSaved('Barème paie CNSS / AMO enregistré.');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FloatingPortal>
      <div className="modal-overlay" onClick={() => !saving && onClose()}>
        <div
          ref={dialog}
          className="modal payroll-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payroll-settings-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-head">
            <div>
              <h2 id="payroll-settings-title">Paramètres CNSS / AMO</h2>
              <p className="muted payroll-settings-sub">
                Barème indicatif Maroc — <strong>à vérifier avec votre comptable</strong> avant clôture de paie.
              </p>
            </div>
            <button type="button" className="modal-x" aria-label="Fermer" onClick={onClose} disabled={saving}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {error && <p className="msg-error" role="alert">{error}</p>}

          {!rates ? (
            !error && <p className="muted" role="status">Chargement des taux…</p>
          ) : (
            <form onSubmit={save}>
              <div className="ac-ops-form-grid-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="ac-erp-field">
                    <span>{f.label}</span>
                    <input
                      type="number"
                      step={f.step}
                      value={rates[f.key] ?? f.fallback}
                      onChange={(e) => setRates((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={onClose} disabled={saving}>
                  Annuler
                </button>
                <button type="submit" disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Enregistrer le barème'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </FloatingPortal>
  );
}
