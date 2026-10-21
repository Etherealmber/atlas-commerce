/**
 * v225 — Atlas Agent & Sécurité panel (Settings → profile tab).
 * 2FA toggle (owner), agent governance (quota/blocks, admin restore),
 * OTP-gated privacy deletes (agent data / account), logged-in devices popup.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type Policy = { blocked: boolean; isAdmin: boolean; dailyUsed: number; weeklyUsed: number; dailyLimit: number; weeklyLimit: number; dailyResetsAt?: string; weeklyResetsAt?: string };
type Device = { fingerprint: string; full: string; last_ip: string; last_seen: string; user_agent: string; current: boolean };
type OtpFlow = { kind: 'agent' | 'account'; message: string; code?: string } | null;

function fmtReset(iso?: string): string {
  if (!iso) return 'au prochain cycle';
  try {
    return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  } catch { return 'au prochain cycle'; }
}

export default function AgentSecurityPanel({ isOwner, role }: { isOwner: boolean; role: string }) {
  const [twoFa, setTwoFa] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [controls, setControls] = useState<any[]>([]);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [otp, setOtp] = useState<OtpFlow>(null);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { const p = await api.getAgentPolicy(); if (p?.data) setPolicy(p.data); } catch { /* */ }
    try { const d = await api.getDevices(); setDevices(d?.data || []); } catch { setDevices([]); }
    if (isOwner) {
      try { const t = await api.get2fa(); setTwoFa(!!t?.data?.enabled); } catch { /* */ }
      try { const c = await api.getAgentControls(); setControls(c?.data || []); } catch { /* */ }
    }
  }, [isOwner]);

  useEffect(() => { void load(); }, [load]);

  const startOtp = async (kind: 'agent' | 'account') => {
    setBusy(kind);
    try {
      const res = kind === 'agent' ? await api.requestAgentDataOtp() : await api.requestAccountOtp();
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
      if (otp.kind === 'agent') {
        await api.deleteAgentData(otpInput.trim());
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('atlas_agent_')) localStorage.removeItem(k);
        }
        setOtp(null);
        setPolicy((p) => (p ? { ...p, dailyUsed: 0, weeklyUsed: 0 } : p));
      } else {
        await api.deleteAccount(otpInput.trim());
        localStorage.clear();
        window.location.assign('/login');
        return;
      }
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
          Gouvernance de l’agent IA : quotas, verrouillage anti-injection, double authentification,
          appareils connectés et suppressions protégées par OTP.
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

        {isOwner && (
          <div className="form-row">
            <label>Double authentification (2FA)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className={twoFa ? 'btn primary' : 'btn secondary'}
                disabled={twoFa === null || busy === '2fa'}
                onClick={async () => {
                  setBusy('2fa');
                  try {
                    const res = await api.put2fa(!twoFa);
                    setTwoFa(!!res?.data?.enabled);
                  } catch { /* */ } finally { setBusy(''); }
                }}
              >
                {twoFa ? '2FA activée' : '2FA désactivée'}
              </button>
              <span className="muted">OTP exigé à chaque connexion, même sur appareil de confiance.</span>
            </div>
          </div>
        )}

        {isOwner && controls.length > 0 && (
          <div className="form-row">
            <label>Accès agent des utilisateurs</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {controls.map((c: any) => (
                <div key={c.username} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code style={{ minWidth: 110 }}>{c.username}</code>
                  <span className="muted">{c.blocked ? 'suspendu' : 'ok'}</span>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={async () => {
                      try {
                        await api.setAgentAccess(c.username, c.blocked ? 'restore' : 'block');
                        void load();
                      } catch { /* */ }
                    }}
                  >
                    {c.blocked ? 'Rétablir' : 'Suspendre'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Appareils connectés</label>
          <div>
            <button type="button" className="btn secondary" onClick={() => setShowDevices(true)}>
              Voir les appareils ({devices?.length ?? '…'})
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Données Atlas Agent</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary" disabled={busy === 'agent'} onClick={() => void startOtp('agent')}>
              Supprimer toutes mes conversations (OTP)
            </button>
          </div>
        </div>

        {role !== 'owner' && (
          <div className="form-row">
            <label>Compte</label>
            <div>
              <button type="button" className="btn danger" disabled={busy === 'account'} onClick={() => void startOtp('account')}>
                Supprimer mon compte (OTP)
              </button>
            </div>
          </div>
        )}

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

      {showDevices && (
        <div className="modal-overlay" onClick={() => setShowDevices(false)}>
          <div className="modal" style={{ maxWidth: 560, width: '94vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>Appareils connectés</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Chaque appareil qui s’est connecté à ce compte. Révoquez ceux que vous ne reconnaissez pas.
            </p>
            {(devices || []).length === 0 && <p className="muted">Aucun appareil enregistré.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(devices || []).map((d) => (
                <div key={d.full} className="ac-device-row">
                  <div>
                    <strong>{d.current ? 'Cet appareil' : d.fingerprint}</strong>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {d.user_agent} · {d.last_seen} · IP {d.last_ip}
                    </span>
                  </div>
                  {!d.current && (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={async () => {
                        try {
                          await api.revokeDevice(d.full);
                          setDevices((prev) => (prev || []).filter((x) => x.full !== d.full));
                        } catch { /* */ }
                      }}
                    >
                      Révoquer
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="ac-modal-foot">
              <button type="button" className="btn secondary" onClick={() => setShowDevices(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
