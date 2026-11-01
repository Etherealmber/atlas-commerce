/**
 * v0.7.7 — Sécurité du COMPTE (Settings → onglet Profil) :
 * 2FA (owner), appareils connectés (popup « Appareils connectés ») et
 * suppression de compte protégée par OTP. Ces lignes vivaient avant dans
 * l'onglet Atlas Agent : ce n'était pas leur place.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';

type Device = { fingerprint: string; full: string; last_ip: string; last_seen: string; user_agent: string; current: boolean; device_label?: string; city?: string; country?: string };
type OtpFlow = { kind: 'account'; message: string; code?: string } | null;

export default function AccountSecurityPanel({ isOwner, role }: { isOwner: boolean; role: string }) {
  const [twoFa, setTwoFa] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [revokedNote, setRevokedNote] = useState(false);
  const [otp, setOtp] = useState<OtpFlow>(null);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { const d = await api.getDevices(); setDevices(d?.data || []); } catch { setDevices([]); }
    if (isOwner) {
      try { const t = await api.get2fa(); setTwoFa(!!t?.data?.enabled); } catch { /* */ }
    }
  }, [isOwner]);

  useEffect(() => { void load(); }, [load]);

  const startOtp = async () => {
    setBusy('account');
    try {
      const res = await api.requestAccountOtp();
      setOtp({ kind: 'account', message: res?.message || 'Code demandé.', code: res?.otp });
      setOtpInput('');
    } catch (e: any) {
      setOtp({ kind: 'account', message: e?.message || 'Impossible de demander le code.' });
    } finally {
      setBusy('');
    }
  };

  const confirmOtp = async () => {
    if (!otp) return;
    setBusy('account');
    try {
      await api.deleteAccount(otpInput.trim());
      localStorage.clear();
      window.location.assign('/login');
      return;
    } catch (e: any) {
      setOtp({ ...otp, message: e?.message || 'Code refusé.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Sécurité du compte</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Double authentification, appareils connectés et suppression de compte —
          tout ce qui touche au compte, au même endroit.
        </p>

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

        <div className="form-row">
          <label>Appareils connectés</label>
          <div>
            <button type="button" className="btn secondary" onClick={() => setShowDevices(true)}>
              Voir les appareils ({devices?.length ?? '…'})
            </button>
          </div>
        </div>

        {role !== 'owner' && (
          <div className="form-row">
            <label>Compte</label>
            <div>
              <button type="button" className="btn danger" disabled={busy === 'account'} onClick={() => void startOtp()}>
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
              <button type="button" className="btn primary" disabled={busy === 'account'} onClick={() => void confirmOtp()}>
                Confirmer
              </button>
              <button type="button" className="btn ghost" onClick={() => setOtp(null)}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {showDevices && createPortal(
        <div className="modal-overlay" onClick={() => setShowDevices(false)}>
          <div className="modal" style={{ maxWidth: 560, width: '94vw' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-x modal-close" aria-label="Fermer" onClick={() => setShowDevices(false)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2>Appareils connectés</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Chaque appareil qui s’est connecté à ce compte. Révoquez ceux que vous ne reconnaissez pas.
            </p>
            {(devices || []).length === 0 && <p className="muted">Aucun appareil enregistré.</p>}
            <div className="ac-device-list">
              {(devices || []).map((d) => {
                const isAndroid = /android/i.test(String(d.user_agent || ''));
                return (
                  <div key={d.full} className="ac-device-row">
                    <span className="ac-device-ico" aria-hidden>
                      {isAndroid ? (
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
                      ) : (
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8 20.5h8M12 16.5v4" /></svg>
                      )}
                    </span>
                    <div className="ac-device-main">
                      <strong>
                        {d.current ? 'Cet appareil' : d.device_label || d.fingerprint}
                        {d.current && <span className="ac-device-chip">actuel</span>}
                      </strong>
                      <span className="ac-device-ua">{d.user_agent}</span>
                      <span className="ac-device-meta">
                        {d.last_seen} · IP {d.last_ip}
                        {(d.city || d.country) ? ` · ${[d.city, d.country].filter(Boolean).join(', ')}` : ''}
                      </span>
                    </div>
                    {!d.current && (
                      <button
                        type="button"
                        className="ac-device-revoke"
                        onClick={async () => {
                          try {
                            await api.revokeDevice(d.full);
                            setDevices((prev) => (prev || []).filter((x) => x.full !== d.full));
                            setRevokedNote(true);
                          } catch { /* */ }
                        }}
                      >
                        Révoquer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {revokedNote && (
              <p className="ac-device-note" role="status">
                Appareil révoqué : un code OTP lui sera demandé à sa prochaine connexion.
              </p>
            )}
            <div className="ac-modal-foot">
              <button type="button" className="btn secondary" onClick={() => setShowDevices(false)}>Fermer</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
