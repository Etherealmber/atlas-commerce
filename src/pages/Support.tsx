import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLandingMotion } from '../hooks/useLandingMotion';
import { PublicNav, PublicSessionCta, GitHubStarButton } from '../components/PublicChrome';
import { getApiBase } from '../config';
import { APP_BUILD_DATE, APP_CREATOR_NAME, APP_NAME, APP_VERSION } from '../version';

const GITHUB_ORG = 'https://github.com/Etherealmber';
const GITHUB_REPO = 'Etherealmber/atlas-commerce';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
const GITHUB_ISSUES = `${GITHUB_REPO_URL}/issues`;
const GITHUB_NEW_ISSUE = `${GITHUB_REPO_URL}/issues/new`;
const GITHUB_RELEASES = `${GITHUB_REPO_URL}/releases`;

function isNativeClient(): boolean {
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) return true;
    if (cap?.getPlatform) {
      const plat = String(cap.getPlatform() || '').toLowerCase();
      if (plat === 'android' || plat === 'ios') return true;
    }
    if (cap && typeof cap.isNativePlatform === 'function') return true;
    const ua = navigator.userAgent || '';
    if (/Atlas-Android|Atlas-iOS/i.test(ua)) return true;
  } catch { /* */ }
  return false;
}

function shouldLoadTurnstile(): boolean {
  return !isNativeClient();
}

function isPwaClient(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      !!(navigator as any).standalone
    );
  } catch {
    return false;
  }
}

function isMobileViewport(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(max-width: 768px)').matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
    );
  } catch {
    return false;
  }
}

const WORKFLOW_STEPS: { code: string; title: string; text: string }[] = [
  {
    code: '01 / Déploiement & accès',
    title: 'Mise en route de votre instance',
    text: 'Configuration de votre espace Atlas Commerce sur Cloudflare Workers, base D1 SQLite, stockage R2 et sécurisation des comptes (WebAuthn, OTP).',
  },
  {
    code: '02 / Exploitation quotidienne',
    title: 'Stock, caisse, devis & factures',
    text: 'Accompagnement sur le catalogue produits, les transferts entre entrepôts, les ventes rapides, les devis convertibles et les exports PDF / CSV.',
  },
  {
    code: '03 / Mises à jour & sécurité',
    title: 'Web, Android & bureau natif',
    text: 'Suivi des versions bêta, remontée des anomalies vers GitHub Issues, vérification d’intégrité CDN1 (SHA-256) et sauvegardes.',
  },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Comment signaler un bug ou demander une fonctionnalité sur Atlas Commerce ?',
    a: 'Remplissez le formulaire ci-dessus après avoir validé la vérification Cloudflare Turnstile, ou ouvrez directement un ticket sur le dépôt GitHub Etherealmber/atlas-commerce.',
  },
  {
    q: 'Où sont hébergées les données de mon instance Atlas Commerce ?',
    a: 'Atlas Commerce est un logiciel auto-hébergé maintenu par Etherealmber : vos données restent sur votre propre compte Cloudflare (Workers, D1 SQLite et R2 Storage).',
  },
  {
    q: 'Comment installer Atlas Commerce sur Android, Windows, macOS ou Linux ?',
    a: 'Téléchargez l’APK officiel depuis la page Android (/android) ou les installateurs bureau natifs (Windows .exe/.msi, macOS .dmg, Linux AppImage) depuis la page Bureau (/desktop).',
  },
  {
    q: 'Comment fonctionnent la connexion OTP, les passkeys WebAuthn et les appareils de confiance ?',
    a: 'Chaque nouvel appareil est validé par code OTP ou clé biométrique WebAuthn. Vous pouvez consulter et révoquer vos appareils actifs depuis Paramètres → Mon profil.',
  },
  {
    q: 'Comment vérifier l’authenticité d’un reçu ou d’une facture émise par Atlas ?',
    a: 'Chaque document généré peut inclure un QR code pointant vers /verify afin de contrôler les informations essentielles du document.',
  },
  {
    q: 'Sous quelles licences Atlas Commerce est-il distribué ?',
    a: 'Atlas Commerce est un projet open source publié par Etherealmber sous double licence MIT ou Apache-2.0. Consultez la page Licences (/licenses) pour les textes complets.',
  },
];

export default function Support() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingMotion(pageRef, '.dl-ed-facts, .dl-ed-section', '.dl-ed-mark');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [environment, setEnvironment] = useState<'web' | 'android' | 'desktop' | 'cloudflare'>('web');
  const [category, setCategory] = useState<'support' | 'auth' | 'billing' | 'bug' | 'feedback' | 'other'>('support');
  const [versionInfo, setVersionInfo] = useState(`v${APP_VERSION}`);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitOk, setSubmitOk] = useState<{ ref: string; issueUrl?: string } | null>(null);
  const [submitErr, setSubmitErr] = useState('');

  // Cloudflare Turnstile — exact same explicit widget lifecycle as Login.tsx
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileTokenRef = useRef('');
  const turnstileWidgetId = useRef<string | undefined>(undefined);
  const [turnstileHint, setTurnstileHint] = useState(false);
  const [turnstileNonce, setTurnstileNonce] = useState(0);

  const retryTurnstile = () => {
    turnstileTokenRef.current = '';
    setTurnstileToken('');
    setTurnstileHint(false);
    try {
      const ts = (window as any).turnstile;
      if (ts && turnstileWidgetId.current != null && ts.reset) {
        ts.reset(turnstileWidgetId.current);
        return;
      }
    } catch { /* fall back to full remount */ }
    setTurnstileNonce((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!shouldLoadTurnstile()) {
          if (!cancelled) {
            setTurnstileSiteKey(null);
            setTurnstileToken('');
          }
          return;
        }
        const client = isPwaClient() ? 'pwa' : isMobileViewport() ? 'mobile-web' : 'web';
        const tr = await fetch(`${getApiBase()}/api/auth/turnstile-config`, {
          headers: { 'X-Atlas-Client': client },
        });
        const tj = (await tr.json().catch(() => ({}))) as {
          data?: { enabled?: boolean; site_key?: string };
        };
        const key = tj?.data?.enabled && tj?.data?.site_key ? String(tj.data.site_key) : '';
        if (!cancelled && key) setTurnstileSiteKey(key);
      } catch {
        /* Turnstile config optional when offline/unreachable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || !shouldLoadTurnstile()) return;
    let cancelled = false;
    let widgetId: string | undefined;
    let rendered = false;
    let poll: number | undefined;
    const timers: number[] = [];
    const el = document.getElementById('cf-turnstile');
    if (!el) return;
    turnstileTokenRef.current = '';
    setTurnstileToken('');
    setTurnstileHint(false);

    const scriptSelector = 'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]';
    let script = document.querySelector<HTMLScriptElement>(scriptSelector);
    if (!(window as any).turnstile && !script) {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
    }
    const fail = () => {
      if (!cancelled) {
        window.clearInterval(poll);
        turnstileTokenRef.current = '';
        setTurnstileToken('');
        setTurnstileHint(true);
      }
    };
    const tryRender = () => {
      if (cancelled || rendered) return;
      const ts = (window as any).turnstile;
      if (!ts?.render) return;
      try {
        const measuredWidth = Math.max(el.clientWidth || 0, el.parentElement?.clientWidth || 0);
        const size = measuredWidth < 280 ? 'compact' : 'flexible';
        const resolvedTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        widgetId = ts.render(el, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            if (cancelled) return;
            turnstileTokenRef.current = token;
            setTurnstileToken(token);
            setTurnstileHint(false);
          },
          'expired-callback': fail,
          'error-callback': fail,
          'timeout-callback': fail,
          theme: resolvedTheme,
          size,
        });
        rendered = true;
        window.clearInterval(poll);
        turnstileWidgetId.current = widgetId;
        timers.push(window.setTimeout(() => {
          if (!cancelled && !turnstileTokenRef.current) setTurnstileHint(true);
        }, 15000));
      } catch {
        fail();
      }
    };
    script?.addEventListener('load', tryRender);
    script?.addEventListener('error', fail);
    if (script && !script.isConnected) document.head.appendChild(script);
    poll = window.setInterval(tryRender, 200);
    tryRender();
    timers.push(window.setTimeout(() => {
      window.clearInterval(poll);
      if (!rendered) fail();
    }, 10000));
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      timers.forEach((timer) => window.clearTimeout(timer));
      script?.removeEventListener('load', tryRender);
      script?.removeEventListener('error', fail);
      try {
        if (widgetId != null) (window as any).turnstile?.remove?.(widgetId);
      } catch { /* */ }
      el.replaceChildren();
      if (turnstileWidgetId.current === widgetId) turnstileWidgetId.current = undefined;
      turnstileTokenRef.current = '';
    };
  }, [turnstileSiteKey, turnstileNonce]);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = `Support — ${APP_NAME}`;
    return () => {
      document.title = prevTitle;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr('');
    setSubmitOk(null);
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      setSubmitErr('Merci de renseigner votre nom, votre e-mail, l’objet et le détail de votre demande.');
      return;
    }
    const token = turnstileTokenRef.current || turnstileToken;
    if (turnstileSiteKey && shouldLoadTurnstile() && !token) {
      setSubmitErr('Veuillez compléter la vérification de sécurité Cloudflare Turnstile avant d’envoyer.');
      return;
    }

    const formattedBody = [
      `Demandeur : ${name.trim()}`,
      `Contact : ${email.trim()}`,
      `Environnement : ${environment}`,
      `Catégorie : ${category}`,
      versionInfo.trim() ? `Version : ${versionInfo.trim()}` : '',
      '',
      `Objet : ${subject.trim()}`,
      '',
      message.trim(),
    ]
      .filter(Boolean)
      .join('\n');

    const issueTitle = `[Support:${category}] ${subject.trim()}`;
    const issueUrl = `${GITHUB_NEW_ISSUE}?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(formattedBody)}`;
    const localRef = `ATLAS-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-4)}`;

    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const authToken = localStorage.getItem('stock_token');
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
      } catch { /* ignore */ }

      const res = await fetch(`${getApiBase()}/api/reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: category === 'bug' ? 'bug' : category === 'feedback' ? 'feedback' : 'other',
          message: formattedBody,
          contact: `${name.trim()} <${email.trim()}>`,
          page: '/support',
          version: versionInfo.trim() || APP_VERSION,
          turnstile_token: token || undefined,
        }),
      });
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const refId = String(data?.data?.reference || data?.reference || localRef);
        setSubmitOk({
          ref: refId,
          issueUrl: data?.data?.issue_url ? String(data.data.issue_url) : undefined,
        });
        setSubject('');
        setMessage('');
        if (turnstileSiteKey && shouldLoadTurnstile()) retryTurnstile();
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch {
      setSubmitOk({ ref: localRef, issueUrl });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="download-landing desktop-landing support-landing" ref={pageRef}>
      <PublicNav
        links={[
          { href: '/', label: 'Accueil' },
          { href: '/desktop', label: 'Bureau' },
          { href: '/android', label: 'Android' },
          { href: '#demande', label: 'Demande' },
          { href: '#faq', label: 'FAQ' },
          { href: '/about', label: 'À propos' },
        ]}
        cta={<PublicSessionCta />}
        classic
      />

      <main className="dl-ed-main">
        <section className="dl-hero dl-ed-hero">
          <div className="dl-container">
            <a className="dl-ed-release-badge" href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true" />
              {APP_NAME} · {APP_CREATOR_NAME} · Support <b aria-hidden="true">↗</b>
            </a>
            <div className="dl-ed-hero-grid">
              <div className="dl-hero-content">
                <h1 className="dl-h1 dl-ed-title">
                  <span className="dl-ed-title-first">Support officiel</span>{' '}
                  <span className="dl-ed-title-second">{APP_NAME}.</span>
                </h1>
                <p className="dl-desc">
                  Assistance technique et produit pour {APP_NAME} ({APP_CREATOR_NAME}) : déploiement, gestion de stock,
                  caisse, facturation, comptes sécurisés, application Android et client bureau.
                </p>
                <div className="dl-ctas">
                  <a className="dl-cta-main support-cta-btn" href="#demande">
                    Ouvrir une demande <span className="dl-cta-arrow" aria-hidden="true">↓</span>
                  </a>
                  <a className="dl-cta-ghost support-cta-btn" href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
                    Tickets GitHub <span className="dl-cta-arrow" aria-hidden="true">↗</span>
                  </a>
                  <Link className="dl-cta-ghost support-cta-btn" to="/about">
                    À propos d’Atlas <span className="dl-cta-arrow" aria-hidden="true">→</span>
                  </Link>
                </div>
                <p className="dl-note">
                  Projet open source maintenu par <strong>{APP_CREATOR_NAME}</strong> · Version <strong>v{APP_VERSION}</strong> · Web, Android &amp; Bureau.
                </p>
              </div>
              <div className="dl-ed-mark" aria-hidden="true">
                <div>
                  <img src="/atlas-icon-light.png" alt="" width="100" height="100" />
                </div>
                <span>ATLAS · SUPPORT</span>
              </div>
            </div>

            <ul className="dl-ed-facts">
              <li>
                <b>Application Web</b>
                <span>Cloudflare Workers, D1 SQLite &amp; R2 Storage</span>
              </li>
              <li>
                <b>Mobile Android</b>
                <span>
                  <Link to="/android">Télécharger l’APK →</Link>
                </span>
              </li>
              <li>
                <b>Client Bureau</b>
                <span>
                  <Link to="/desktop">Windows, macOS &amp; Linux →</Link>
                </span>
              </li>
              <li>
                <b>Dépôt officiel</b>
                <span>
                  <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">{GITHUB_REPO} ↗</a>
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="demande" aria-labelledby="support-form-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">01 / ASSISTANCE</p>
              <h2 id="support-form-title">Nouvelle demande</h2>
              <p>
                Décrivez votre question technique, anomalie ou besoin de configuration sur {APP_NAME}. Protégé par Cloudflare Turnstile.
              </p>
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">Suivre les tickets GitHub ↗</a>
            </div>
            <div className="dl-ed-content">
              <form className="dl-support-form" onSubmit={handleSubmit}>
                <div className="dl-support-grid">
                  <label>
                    <span>Nom complet *</span>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Nadia El Amrani" required />
                  </label>
                  <label>
                    <span>E-mail *</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.com" required />
                  </label>
                  <label>
                    <span>Environnement</span>
                    <select value={environment} onChange={(e) => setEnvironment(e.target.value as typeof environment)}>
                      <option value="web">Web (navigateur)</option>
                      <option value="android">Application Android</option>
                      <option value="desktop">Application bureau (Windows / macOS / Linux)</option>
                      <option value="cloudflare">Instance Cloudflare (Workers / D1 / R2)</option>
                    </select>
                  </label>
                  <label>
                    <span>Catégorie</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                      <option value="support">Assistance technique &amp; déploiement</option>
                      <option value="auth">Compte, rôles, WebAuthn &amp; OTP</option>
                      <option value="billing">Stock, caisse &amp; facturation</option>
                      <option value="bug">Signalement de bug</option>
                      <option value="feedback">Suggestion d’amélioration</option>
                      <option value="other">Autre demande</option>
                    </select>
                  </label>
                  <label>
                    <span>Version (optionnel)</span>
                    <input type="text" value={versionInfo} onChange={(e) => setVersionInfo(e.target.value)} placeholder={`v${APP_VERSION}`} />
                  </label>
                  <label>
                    <span>Objet *</span>
                    <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Résumé court de votre demande" required />
                  </label>
                </div>
                <label className="dl-support-full">
                  <span>Message *</span>
                  <textarea
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Décrivez le module concerné, les étapes effectuées et le résultat attendu..."
                    required
                  />
                </label>

                {turnstileSiteKey && shouldLoadTurnstile() ? (
                  <div id="cf-turnstile" className="atlas-turnstile" />
                ) : null}
                {turnstileHint ? (
                  <div className="atlas-turnstile-hint" role="status">
                    <p style={{ margin: 0 }}>
                      Vérification Cloudflare indisponible sur cette connexion — réessayez depuis un autre réseau ou relancez la vérification.
                    </p>
                    <button type="button" className="atlas-turnstile-retry" onClick={retryTurnstile}>
                      Réessayer la vérification
                    </button>
                  </div>
                ) : null}

                {submitErr && <p className="dl-support-err">{submitErr}</p>}
                {submitOk && (
                  <div className="dl-support-ok" role="status">
                    <strong>Demande préparée — Référence {submitOk.ref}</strong>
                    {submitOk.issueUrl ? (
                      <p>
                        Suivi GitHub disponible :{' '}
                        <a href={submitOk.issueUrl} target="_blank" rel="noopener noreferrer">
                          Ouvrir le ticket pré-rempli sur {GITHUB_REPO} ↗
                        </a>
                      </p>
                    ) : (
                      <p>Votre demande a bien été transmise au support {APP_NAME} ({APP_CREATOR_NAME}).</p>
                    )}
                  </div>
                )}

                <div className="dl-support-actions">
                  <button type="submit" className="dl-cta-main support-cta-btn" disabled={submitting}>
                    {submitting ? 'Envoi en cours…' : 'Envoyer la demande'}
                  </button>
                  <a className="dl-cta-ghost support-cta-btn" href={GITHUB_NEW_ISSUE} target="_blank" rel="noopener noreferrer">
                    Ouvrir un ticket GitHub ↗
                  </a>
                </div>
              </form>
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="suivi" aria-labelledby="support-ecosystem-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">02 / ÉCOSYSTÈME</p>
              <h2 id="support-ecosystem-title">Plateformes &amp; versions</h2>
              <p>Retrouvez les notes de version, téléchargements et dépôts maintenus par {APP_CREATOR_NAME}.</p>
              <a href={GITHUB_RELEASES} target="_blank" rel="noopener noreferrer">Toutes les versions GitHub ↗</a>
            </div>
            <div className="dl-ed-content">
              <div className="dl-stats">
                <div className="dl-stat">
                  <strong>v{APP_VERSION}</strong>
                  <span>Version courante</span>
                </div>
                <div className="dl-stat">
                  <strong>{APP_CREATOR_NAME}</strong>
                  <span>Équipe &amp; maintenance</span>
                </div>
                <div className="dl-stat">
                  <strong>MIT / Apache-2.0</strong>
                  <span>Double licence ouverte</span>
                </div>
              </div>
              <div className="dl-ed-files" style={{ marginTop: 14 }}>
                <div className="dl-ed-download-row">
                  <div>
                    <strong>Atlas Commerce Web &amp; API</strong>
                    <span>React · Cloudflare Workers · D1 / R2</span>
                  </div>
                  <Link to="/whats-new">Nouveautés ↗</Link>
                </div>
                <div className="dl-ed-download-row">
                  <div>
                    <strong>Atlas Commerce Android</strong>
                    <span>APK signée · Mises à jour CDN1</span>
                  </div>
                  <Link to="/android">Page Android ↗</Link>
                </div>
                <div className="dl-ed-download-row">
                  <div>
                    <strong>Atlas Commerce Bureau (Rust natif)</strong>
                    <span>Windows · macOS · Linux via CDN1</span>
                  </div>
                  <Link to="/desktop">Page Bureau ↗</Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" aria-labelledby="support-workflow-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">03 / PARCOURS</p>
              <h2 id="support-workflow-title">Accompagnement {APP_NAME}.</h2>
              <p>Du déploiement Cloudflare jusqu’aux opérations quotidiennes sur Web, mobile et bureau.</p>
              <GitHubStarButton repo={GITHUB_REPO} />
            </div>
            <div className="dl-feats">
              {WORKFLOW_STEPS.map((s) => (
                <div key={s.code} className="dl-feat">
                  <strong>{s.code} · {s.title}</strong>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="faq" aria-labelledby="support-faq-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">04 / FAQ</p>
              <h2 id="support-faq-title">Questions fréquentes</h2>
              <p>Réponses rapides sur le fonctionnement, la sécurité et le déploiement d’{APP_NAME}.</p>
              <Link to="/about">À propos d’Atlas ↗</Link>
            </div>
            <div className="dl-ed-content dl-support-faq">
              {FAQ_ITEMS.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="dl-foot">
        <div className="dl-foot-inner">
          <div className="dl-foot-brand">
            <img src="/atlas-logo-dark.png" alt={APP_NAME} className="theme-logo-dark" width={117} height={38} style={{ height: 38, width: 117 }} />
            <img src="/atlas-logo-light.png" alt={APP_NAME} className="theme-logo-light" width={117} height={38} style={{ height: 38, width: 117 }} />
            <p>{APP_NAME} par {APP_CREATOR_NAME} — logiciel de gestion stock, caisse et facturation.</p>
          </div>
          <nav aria-label="Liens support et produit">
            <Link to="/">Accueil</Link>
            <Link to="/desktop">Bureau</Link>
            <Link to="/android">Android</Link>
            <Link to="/whats-new">Nouveautés</Link>
            <Link to="/about">À propos</Link>
            <Link to="/privacy">Confidentialité</Link>
            <Link to="/terms">Conditions</Link>
            <Link to="/licenses">Licences</Link>
            <a href={GITHUB_ORG} target="_blank" rel="noopener noreferrer">{APP_CREATOR_NAME}</a>
            <Link to="/login">Se connecter</Link>
          </nav>
        </div>
        <div className="dl-foot-bottom">
          <span>© {new Date().getFullYear()} {APP_NAME} · {APP_CREATOR_NAME}</span>
          <span>{APP_BUILD_DATE}</span>
        </div>
      </footer>
    </div>
  );
}
