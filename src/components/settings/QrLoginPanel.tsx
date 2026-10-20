import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { getUsername, getRole } from '../../auth';
import ShowQr from '../ui/ShowQr';

type Session = {
  token: string;
  expires_at: string;
  qr_url: string;
  username: string;
  role: string;
};

/** PC-only QR login — session starts only when user opens the QR. */
export default function QrLoginPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [err, setErr] = useState('');
  const [left, setLeft] = useState(60);
  const [targetUser, setTargetUser] = useState(getUsername());
  const [users, setUsers] = useState<{ username: string; role: string; label?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const tickRef = useRef(0);
  const creatingRef = useRef(false);
  const lifetimeRef = useRef(0);
  const isPc = typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches;
  const canPickUser = getRole() === 'owner' || getRole() === 'admin';

  useEffect(() => {
    if (!canPickUser) return;
    (async () => {
      try {
        const r = await api.getAdminUsers();
        const d = (r as any)?.data || {};
        const list: { username: string; role: string; label?: string }[] = [];
        if (d.owner?.username) {
          list.push({
            username: String(d.owner.username),
            role: 'owner',
            label: d.owner.display_name || d.owner.username,
          });
        }
        for (const u of d.users || []) {
          if (!u?.username || u.active === 0) continue;
          list.push({
            username: String(u.username),
            role: String(u.role || 'user'),
            label: u.display_name || u.username,
          });
        }
        const seen = new Set<string>();
        setUsers(
          list.filter((u) => {
            const k = u.username.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          }),
        );
      } catch { /* */ }
    })();
  }, [canPickUser]);

  const create = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setErr('');
    try {
      const body =
        canPickUser && targetUser && targetUser !== getUsername()
          ? { username: targetUser }
          : {};
      const res = await api.qrLoginCreate(body);
      const d = res.data;
      if (!d?.token || !d?.qr_url) throw new Error('Création QR impossible');
      setSession(d);
      setStatus('pending');
      setLeft(60);
      lifetimeRef.current = 0;
    } catch (e: any) {
      setErr(e?.message || 'Erreur QR');
      setStatus('idle');
    } finally {
      creatingRef.current = false;
    }
  }, [canPickUser, targetUser]);

  // Settings: max 120s lifetime; pause rotation when phone claimed/approved
  useEffect(() => {
    if (!open || !session) return;
    lifetimeRef.current = 0;
    const id = window.setInterval(() => {
      lifetimeRef.current += 1;
      setLeft((n) => {
        if (status === 'claimed' || status === 'approved' || status === 'consumed') {
          return n; // freeze QR
        }
        if (lifetimeRef.current >= 120) {
          setStatus('stopped');
          return 0;
        }
        if (n <= 1) {
          void create(); // rotate every 60s while pending
          return 60;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, session?.token, create, status]);

  useEffect(() => {
    if (!open || !session?.token || status === 'stopped') return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const st = await api.qrLoginStatus(session.token);
        const s = st.data?.status || '';
        setStatus(s === 'expired' ? 'stopped' : s);
        // Do not auto-create on expire — user taps retry
      } catch { /* */ }
      tickRef.current = window.setTimeout(poll, 2000) as unknown as number;
    };
    void poll();
    return () => {
      stopped = true;
      if (tickRef.current) window.clearTimeout(tickRef.current);
    };
  }, [open, session?.token, status]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void create();
    } else {
      setStatus('idle');
    }
  };

  if (!isPc) {
    return (
      <div className="qr-login-panel qr-login-panel--mobile">
        <p>Lancez le QR depuis un ordinateur, puis scannez-le avec ce téléphone.</p>
      </div>
    );
  }

  // Stable placeholder until session exists — never remount ShowQr on open/create
  const qrValue = session?.qr_url || '';

  return (
    <div className="qr-login-panel">
      <div className="qr-login-head">
        <h3>Connexion par QR</h3>
        <p className="muted">
          Appuyez sur « Afficher le QR » pour démarrer un code (60&nbsp;s, usage unique).
        </p>
      </div>

      {canPickUser ? (
        <label className="qr-login-user">
          Compte cible
          <select
            value={targetUser}
            onChange={(e) => {
              setTargetUser(e.target.value);
              if (open) void create();
            }}
          >
            <option value={getUsername()}>{getUsername()} (vous)</option>
            {users
              .filter((u) => u.username.toLowerCase() !== getUsername().toLowerCase())
              .map((u) => (
                <option key={u.username} value={u.username}>
                  {u.label || u.username} ({u.role})
                </option>
              ))}
          </select>
        </label>
      ) : null}

      {err ? <p className="qr-login-err">{err}</p> : null}

      <div className="qr-login-show">
        <ShowQr
          value={qrValue || 'about:blank'}
          buttonLabel="Afficher le QR de connexion"
          defaultOpen={false}
          onOpenChange={onOpenChange}
        />
      </div>

      {status === 'stopped' ? (
        <div className="qr-login-stopped">
          <p className="muted">QR arrêté (120&nbsp;s ou session expirée).</p>
          <button type="button" className="atlas-login-submit" style={{ maxWidth: 200 }} onClick={() => void create()}>
            Réessayer
          </button>
        </div>
      ) : null}

      {open && status !== 'stopped' ? (
        <>
          <p className="qr-login-meta">
            Compte : <strong>{session?.username || targetUser || '—'}</strong>
            {session ? (
              <>
                {' · '}
                <span className="tabular">{left}s</span>
              </>
            ) : null}
          </p>
          <p className="qr-login-status">
            {!session && 'Génération du code…'}
            {status === 'pending' && 'En attente du scan…'}
            {status === 'claimed' && 'Téléphone détecté — accepter ou refuser :'}
            {status === 'approved' && 'Approuvé — le téléphone se connecte…'}
            {status === 'denied' && 'Refusé'}
            {status === 'consumed' && 'Connexion effectuée'}
            {status === 'expired' && 'Expiré — nouveau code…'}
          </p>

          {status === 'claimed' && session ? (
            <div className="qr-login-actions">
              <button
                type="button"
                onClick={async () => {
                  await api.qrLoginApprove(session.token);
                  setStatus('approved');
                }}
              >
                Accepter
              </button>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  await api.qrLoginDeny(session.token);
                  setStatus('denied');
                  window.setTimeout(() => void create(), 800);
                }}
              >
                Refuser
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="qr-login-status muted">Le code n’est actif qu’après « Afficher le QR ».</p>
      )}
    </div>
  );
}
