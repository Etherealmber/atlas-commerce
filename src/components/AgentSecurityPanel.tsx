/**
 * v225 — Atlas Agent & Sécurité panel (Settings → profile tab).
 * 2FA toggle (owner), agent governance (quota/blocks, admin restore),
 * OTP-gated privacy deletes (agent data / account), logged-in devices popup.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';

type Policy = { blocked: boolean; isAdmin: boolean; dailyUsed: number; weeklyUsed: number; dailyLimit: number; weeklyLimit: number; dailyResetsAt?: string; weeklyResetsAt?: string };
type OtpFlow = { kind: 'agent'; message: string; code?: string } | null;

function fmtReset(iso?: string): string {
  if (!iso) return 'au prochain cycle';
  try {
    return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  } catch { return 'au prochain cycle'; }
}

export default function AgentSecurityPanel({ isOwner }: { isOwner: boolean; role: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [controls, setControls] = useState<any[]>([]);
  // v0.7.7 — accès agent : popup dédié, même patron que « Appareils connectés »
  const [showAccess, setShowAccess] = useState(false);
  const [otp, setOtp] = useState<OtpFlow>(null);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { const p = await api.getAgentPolicy(); if (p?.data) setPolicy(p.data); } catch { /* */ }
    if (isOwner) {
      try { const c = await api.getAgentControls(); setControls(c?.data || []); } catch { /* */ }
    }
  }, [isOwner]);

  useEffect(() => { void load(); }, [load]);

  const startOtp = async (kind: 'agent') => {
    setBusy(kind);
    try {
      const res = await api.requestAgentDataOtp();
      setOtp({ kind, message: res?.message || 'Code demandé.', code: res?.otp });
      setOtpInput('');
    } catch (e: any) {
      setOtp({ kind, message: e?.message || 'Impossible de demander le code.' });
    } finally {
      setBusy('');
    }
  };

  const confirmOtp = async () => {
    if (!otp) return;
    setBusy(otp.kind);
    try {
      await api.deleteAgentData(otpInput.trim());
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('atlas_agent_')) localStorage.removeItem(k);
      }
      setOtp(null);
      setPolicy((p) => (p ? { ...p, dailyUsed: 0, weeklyUsed: 0 } : p));
      void load();
    } catch (e: any) {
      setOtp({ ...otp, message: e?.message || 'Code refusé.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Atlas Agent & Sécurité</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Gouvernance de l’agent IA : quotas, verrouillage anti-injection, accès utilisateurs et
          suppressions protégées par OTP. (2FA et appareils connectés : onglet Profil → « Sécurité du compte ».)
        </p>

        <div className="form-row">
          <label>Atlas Agent — statut</label>
          <div>
            {policy?.blocked ? (
              <strong style={{ color: 'var(--atlas-danger, #b91c1c)' }}>Accès suspendu (rétablissement par un administrateur)</strong>
            ) : (
              <strong>Actif</strong>
            )}
            {policy?.isAdmin && <span className="muted" style={{ marginLeft: 8 }}>Admin : sans limite</span>}
          </div>
          {policy && !policy.blocked && (
            <div className="ac-quota">
              <div className="ac-quota-row">
                <div className="ac-quota-head">
                  <span>Quota quotidien{policy.isAdmin ? ' · admin illimité' : ''}</span>
                  <strong>{policy.dailyUsed.toLocaleString('fr-FR')} / {policy.dailyLimit.toLocaleString('fr-FR')} jetons</strong>
                </div>
                <div className="ac-quota-bar" role="progressbar" aria-valuemin={0} aria-valuemax={policy.dailyLimit} aria-valuenow={policy.dailyUsed}>
                  <i className={!policy.isAdmin && policy.dailyUsed >= policy.dailyLimit ? 'full' : !policy.isAdmin && policy.dailyUsed > policy.dailyLimit * 0.8 ? 'warn' : undefined} style={{ width: `${Math.min(100, Math.round((policy.dailyUsed / policy.dailyLimit) * 100))}%` }} />
                </div>
                <span className="ac-quota-reset">Rafraîchit {fmtReset(policy.dailyResetsAt)} (minuit UTC), chaque jour à la même heure</span>
              </div>
              <div className="ac-quota-row">
                <div className="ac-quota-head">
                  <span>Quota hebdomadaire{policy.isAdmin ? ' · admin illimité' : ''}</span>
                  <strong>{policy.weeklyUsed.toLocaleString('fr-FR')} / {policy.weeklyLimit.toLocaleString('fr-FR')} jetons</strong>
                </div>
                <div className="ac-quota-bar" role="progressbar" aria-valuemin={0} aria-valuemax={policy.weeklyLimit} aria-valuenow={policy.weeklyUsed}>
                  <i className={!policy.isAdmin && policy.weeklyUsed >= policy.weeklyLimit ? 'full' : !policy.isAdmin && policy.weeklyUsed > policy.weeklyLimit * 0.8 ? 'warn' : undefined} style={{ width: `${Math.min(100, Math.round((policy.weeklyUsed / policy.weeklyLimit) * 100))}%` }} />
                </div>
                <span className="ac-quota-reset">Rafraîchit {fmtReset(policy.weeklyResetsAt)} (lundi 00:00 UTC), chaque semaine au même moment</span>
              </div>
            </div>
          )}
        </div>

        {isOwner && controls.length > 0 && (
          <div className="form-row">
            <label>Accès agent des utilisateurs</label>
            <div>
              <button type="button" className="btn secondary" onClick={() => setShowAccess(true)}>
                Gérer les accès ({controls.length ?? '…'})
              </button>
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Données Atlas Agent</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary" disabled={busy === 'agent'} onClick={() => void startOtp('agent')}>
              Supprimer toutes mes conversations (OTP)
            </button>
          </div>
        </div>

        {otp && (
          <div className="modal-note" style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 8px' }}>{otp.message}</p>
            {otp.code && <p style={{ margin: '0 0 8px' }}>Code (environnement local) : <code>{otp.code}</code></p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                placeholder="Code OTP"
                inputMode="numeric"
                autoComplete="one-time-code"
                style={{ maxWidth: 140 }}
              />
              <button type="button" className="btn primary" disabled={busy === otp.kind} onClick={() => void confirmOtp()}>
                Confirmer
              </button>
              <button type="button" className="btn ghost" onClick={() => setOtp(null)}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {showAccess && createPortal(
        <div className="modal-overlay" onClick={() => setShowAccess(false)}>
          <div className="modal" style={{ maxWidth: 560, width: '94vw' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-x modal-close" aria-label="Fermer" onClick={() => setShowAccess(false)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2>Accès agent des utilisateurs</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Suspendez ou rétablissez l’accès à l’Atlas Agent compte par compte (abus ou injection de prompt).
              Un compte suspendu voit sa barre de saisie masquée et un popup d’explication.
            </p>
            {(controls || []).length === 0 && <p className="muted">Aucun compte enregistré.</p>}
            <div className="ac-device-list">
              {(controls || []).map((ctl: any) => (
                <div key={ctl.username} className="ac-device-row">
                  <span className="ac-device-ico" aria-hidden>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  </span>
                  <div className="ac-device-main">
                    <strong>
                      {ctl.username}
                      <span className="ac-device-chip">{ctl.blocked ? 'suspendu' : 'ok'}</span>
                    </strong>
                    <span className="ac-device-meta">
                      {ctl.blocked
                        ? 'Accès verrouillé — barre de saisie masquée, popup affiché.'
                        : 'Accès normal (quotas appliqués).'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ac-device-revoke"
                    onClick={async () => {
                      try {
                        await api.setAgentAccess(ctl.username, ctl.blocked ? 'restore' : 'block');
                        void load();
                      } catch { /* */ }
                    }}
                  >
                    {ctl.blocked ? 'Rétablir' : 'Suspendre'}
                  </button>
                </div>
              ))}
            </div>
            <div className="ac-modal-foot">
              <button type="button" className="btn secondary" onClick={() => setShowAccess(false)}>Fermer</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
