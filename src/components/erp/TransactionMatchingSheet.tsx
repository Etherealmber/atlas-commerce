import { useState } from 'react';
import './atlas-tokens.css';
import './TransactionMatchingSheet.css';

export type MatchCandidate = {
  id: string;
  title: string;
  subtitle?: string;
  amount?: number;
  score?: number;
};

export type SheetTransaction = {
  id?: string;
  date: string;
  description: string;
  amount: number;
  type?: 'deposit' | 'withdrawal';
};

type Props = {
  isOpen?: boolean;
  open?: boolean;
  onClose: () => void;
  transaction: SheetTransaction | null;
  candidates?: MatchCandidate[];
  onConfirmMatch?: (transactionId: string, matchedId: string) => void;
  onConfirm?: (matchedId: string) => void;
  currency?: string;
};

function fmt(n: number) {
  return Math.round(Math.abs(Number(n || 0))).toLocaleString('fr-FR');
}

/** ERPNext-style matching sheet — pure React + CSS tokens (no Lucide/Tailwind). */
export default function TransactionMatchingSheet({
  isOpen,
  open,
  onClose,
  transaction,
  candidates = [],
  onConfirmMatch,
  onConfirm,
  currency = 'MAD',
}: Props) {
  const shown = isOpen ?? open ?? false;
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(
    candidates[0]?.id ?? null,
  );

  if (!shown || !transaction) return null;

  const deposit = transaction.type === 'deposit' || transaction.amount >= 0;
  const list = candidates.length
    ? candidates
    : [];

  return (
    <div className="atlas-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="atlas-sheet-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Rapprochement"
      >
        <div className="atlas-sheet-header">
          <div className="atlas-sheet-top-row">
            <span className="atlas-status-tag">Écriture non rapprochée</span>
            <div className="atlas-header-actions">
              <span className="atlas-date-text">{transaction.date}</span>
              <button type="button" className="atlas-close-btn" onClick={onClose} aria-label="Fermer">
                ×
              </button>
            </div>
          </div>
          <h3 className="atlas-sheet-title">{transaction.description || '—'}</h3>
          <p className={`atlas-sheet-amount${deposit ? '' : ' debit'}`}>
            {deposit ? '+' : '−'}
            {fmt(transaction.amount)} {currency}
          </p>
        </div>

        <div className="atlas-sheet-body">
          <div className="atlas-section-label">
            <span className="atlas-ai-title">Candidats Atlas</span>
            <span>Score</span>
          </div>

          {list.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--atlas-text-secondary)' }}>
              Aucun candidat automatique. Lancez le rapprochement ou cherchez manuellement.
            </p>
          )}

          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`atlas-match-card${selectedMatchId === c.id ? ' selected' : ''}`}
              onClick={() => setSelectedMatchId(c.id)}
            >
              <div className="atlas-card-top">
                <span className="atlas-party-name">{c.title}</span>
                {c.score != null && (
                  <span className="atlas-match-score">{c.score}% match</span>
                )}
              </div>
              {c.subtitle && <p className="atlas-subtext">{c.subtitle}</p>}
              <div className="atlas-card-footer">
                <span>Montant</span>
                <strong className="atlas-mono-amt">
                  {c.amount != null ? `${fmt(c.amount)} ${currency}` : '—'}
                </strong>
              </div>
            </button>
          ))}

          <button
            type="button"
            className="atlas-search-btn"
            onClick={() => {
              window.location.href = '/balance';
            }}
          >
            Rechercher dans Solde & factures
          </button>
        </div>

        <div className="atlas-sheet-footer">
          <button type="button" className="atlas-btn-secondary" onClick={onClose}>
            Plus tard
          </button>
          <button
            type="button"
            className="atlas-btn-primary"
            disabled={!selectedMatchId}
            onClick={() => {
              if (!selectedMatchId) return;
              onConfirm?.(selectedMatchId);
              onConfirmMatch?.(transaction.id || '', selectedMatchId);
              onClose();
            }}
          >
            Confirmer le match
          </button>
        </div>
      </div>
    </div>
  );
}
