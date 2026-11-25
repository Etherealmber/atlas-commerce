/**
 * v0.9.3 — Guide de bienvenue « mobile web » (téléphones et écrans ≤ 900 px).
 *
 * Distinct du guide bureau (src/pages/Welcome.tsx, 12 étapes, captures larges) :
 * 5 écrans plein format pensés pour le pouce — gros boutons en bas, balayage
 * gauche / droite, zones sûres iOS/Android, thème clair / sombre / système.
 *
 *   0. Bonjour            — accueil personnalisé
 *   1. Thème              — Clair / Sombre / Système (appliqué immédiatement)
 *   2. Sur votre téléphone — ce que fait Atlas mobile, selon le rôle
 *   3. Captures réelles    — carrousel des écrans mobiles
 *   4. Prêt                — récapitulatif + visite guidée (démonstration)
 *
 * Terminer → markWelcomeCompleted() + queuePhoneOnboarding() → /m, où
 * PhoneOnboarding lance la visite mobile. Rien n’est envoyé au serveur.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bot, Check, Compass, Monitor, Moon, Package, ScanLine, ShoppingCart, Sparkles, Sun } from 'lucide-react';
import { canManageStock, canSell, getDisplayName, getRole, getUsername } from '../auth';
import { getTheme, setTheme, type ThemeChoice } from '../theme';
import { isWelcomeCompleted, markWelcomeCompleted, saveWelcomePrefs } from '../lib/welcome';
import { finishPhoneOnboarding, queuePhoneOnboarding } from '../lib/onboarding';
import { APP_NAME, APP_VERSION } from '../version';
import './phone-welcome.css';

export const PHONE_WELCOME_STEP_KEY = 'atlas_phone_welcome_step';

export const PHONE_WELCOME_SHOTS = [
  { src: '/shots/phone-home-demo.webp', title: 'Accueil', text: 'Trésorerie, stock et alertes en un coup d’œil.' },
  { src: '/shots/phone-products-demo.webp', title: 'Produits', text: 'Catalogue, seuils bas et réapprovisionnement.' },
  { src: '/shots/android-scan-demo.webp', title: 'Scan', text: 'Code-barres → fiche produit en une seconde.' },
  { src: '/shots/phone-balance-demo.webp', title: 'Balance', text: 'Recettes, dépenses et caisse au même endroit.' },
] as const;

export const PHONE_WELCOME_STEPS = ['hello', 'theme', 'features', 'shots', 'ready'] as const;
const LAST = PHONE_WELCOME_STEPS.length - 1;

function readStep(): number {
  try {
    const n = Number(sessionStorage.getItem(PHONE_WELCOME_STEP_KEY));
    return Number.isFinite(n) && n >= 0 && n <= LAST ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function firstName(): string {
  const name = (getDisplayName() || getUsername() || '').trim();
  return name.split(/\s+/)[0] || '';
}

type Feature = { id: string; icon: typeof ScanLine; title: string; text: string };

export function phoneWelcomeFeatures(): Feature[] {
  const list: Feature[] = [];
  if (canManageStock() || getRole() === 'stock') {
    list.push({ id: 'scan', icon: ScanLine, title: 'Scanner', text: 'Visez un code-barres : la fiche produit, le stock et l’historique s’ouvrent.' });
  }
  list.push({ id: 'products', icon: Package, title: 'Produits & stock', text: 'Cherchez, filtrez les ruptures et proposez un ajustement au bureau.' });
  if (canSell()) {
    list.push({ id: 'sell', icon: ShoppingCart, title: 'Vente rapide', text: 'Un ticket, un paiement : la caisse et le stock se mettent à jour.' });
  }
  list.push({ id: 'agent', icon: Bot, title: 'Atlas Agent', text: '« Rapport du jour », « Stock bas ? » : l’agent prépare, vous confirmez.' });
  return list;
}

const THEMES: { id: ThemeChoice; label: string; hint: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Clair', hint: 'Surfaces blanches, idéal en journée', icon: Sun },
  { id: 'dark', label: 'Sombre', hint: 'Charbon neutre, repose les yeux', icon: Moon },
  { id: 'system', label: 'Système', hint: 'Suit le réglage du téléphone', icon: Monitor },
];

export default function PhoneWelcome() {
  const navigate = useNavigate();
  const [step, setStep] = useState(readStep);
  const [theme, setThemeState] = useState<ThemeChoice>(() => getTheme());
  const [shot, setShot] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const shotsRef = useRef<HTMLDivElement | null>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const name = firstName();
  const features = phoneWelcomeFeatures();

  useEffect(() => {
    if (isWelcomeCompleted()) navigate('/m', { replace: true });
  }, [navigate]);

  useEffect(() => {
    try { sessionStorage.setItem(PHONE_WELCOME_STEP_KEY, String(step)); } catch { /* */ }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(LAST, n))), []);

  const pickTheme = (t: ThemeChoice) => {
    setThemeState(t);
    setTheme(t);
    saveWelcomePrefs({ theme: t });
  };

  const finish = useCallback((withTour: boolean) => {
    if (leaving) return;
    setLeaving(true);
    markWelcomeCompleted();
    if (withTour) queuePhoneOnboarding();
    else finishPhoneOnboarding();
    try { sessionStorage.removeItem(PHONE_WELCOME_STEP_KEY); } catch { /* */ }
    window.setTimeout(() => navigate('/m', { replace: true }), 220);
  }, [leaving, navigate]);

  // Swipe left / right anywhere except inside the screenshot carousel.
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('.pw-shots, button, a, input')) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
    go(dx < 0 ? step + 1 : step - 1);
  };

  const onShotsScroll = () => {
    const el = shotsRef.current;
    if (!el || !el.clientWidth) return;
    setShot(Math.max(0, Math.min(PHONE_WELCOME_SHOTS.length - 1, Math.round(el.scrollLeft / (el.clientWidth * 0.78)))));
  };

  const themeLabel = THEMES.find((t) => t.id === theme)?.label || 'Système';

  return (
    <div
      className={`pw-stage${leaving ? ' is-leaving' : ''}`}
      data-step={PHONE_WELCOME_STEPS[step]}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <header className="pw-top">
        <span className="pw-brand"><Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />{APP_NAME}</span>
        <div className="pw-dots" role="progressbar" aria-label="Progression du guide" aria-valuemin={1} aria-valuemax={LAST + 1} aria-valuenow={step + 1}>
          {PHONE_WELCOME_STEPS.map((id, i) => <i key={id} className={i === step ? 'is-active' : i < step ? 'is-done' : ''} />)}
        </div>
        {step < LAST ? (
          <button type="button" className="pw-skip" onClick={() => finish(false)}>Passer</button>
        ) : <span className="pw-skip-spacer" aria-hidden="true" />}
      </header>

      <main className="pw-body" key={step}>
        {step === 0 && (
          <section className="pw-panel pw-hello">
            <div className="pw-mark" aria-hidden="true"><Sparkles size={30} strokeWidth={1.8} /></div>
            <h1 ref={headingRef} tabIndex={-1}>{name ? `Bonjour, ${name}` : 'Bonjour'}</h1>
            <p className="pw-lead">Atlas Commerce dans votre poche : scanner, vendre et suivre votre stock, où que vous soyez.</p>
            <ul className="pw-chips" aria-label="En bref">
              <li>Synchronisé avec le bureau</li>
              <li>Fonctionne hors ligne</li>
              <li>v{APP_VERSION}</li>
            </ul>
          </section>
        )}

        {step === 1 && (
          <section className="pw-panel">
            <p className="pw-kicker">Apparence</p>
            <h1 ref={headingRef} tabIndex={-1}>Choisissez votre thème</h1>
            <p className="pw-lead">Modifiable à tout moment dans Profil → Réglages.</p>
            <div className="pw-themes" role="radiogroup" aria-label="Thème">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.id}
                  className={`pw-theme${theme === t.id ? ' is-on' : ''}`}
                  data-theme-toggle
                  onClick={() => pickTheme(t.id)}
                >
                  <span className={`pw-theme-swatch pw-theme-swatch--${t.id}`} aria-hidden="true"><i /><i /><i /></span>
                  <span className="pw-theme-txt"><strong><t.icon size={15} aria-hidden="true" /> {t.label}</strong><small>{t.hint}</small></span>
                  <span className="pw-theme-check" aria-hidden="true">{theme === t.id ? <Check size={15} strokeWidth={2.6} /> : null}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="pw-panel">
            <p className="pw-kicker">Sur votre téléphone</p>
            <h1 ref={headingRef} tabIndex={-1}>L’essentiel, au bout du pouce</h1>
            <div className="pw-features">
              {features.map((f) => (
                <div key={f.id} className="pw-feature" data-feature={f.id}>
                  <span className="pw-feature-ico" aria-hidden="true"><f.icon size={20} strokeWidth={1.9} /></span>
                  <span><strong>{f.title}</strong><small>{f.text}</small></span>
                </div>
              ))}
            </div>
            <p className="pw-note">Factures, devis, paie et rapports complets restent sur ordinateur.</p>
          </section>
        )}

        {step === 3 && (
          <section className="pw-panel pw-panel--shots">
            <p className="pw-kicker">Captures réelles</p>
            <h1 ref={headingRef} tabIndex={-1}>Voici à quoi ça ressemble</h1>
            <div className="pw-shots" ref={shotsRef} onScroll={onShotsScroll} aria-label="Captures de l’application mobile">
              {PHONE_WELCOME_SHOTS.map((s) => (
                <figure key={s.src} className="pw-shot">
                  <img src={s.src} alt={`Capture réelle : ${s.title} sur mobile`} loading="lazy" decoding="async" width={300} height={600} />
                  <figcaption><strong>{s.title}</strong><small>{s.text}</small></figcaption>
                </figure>
              ))}
            </div>
            <div className="pw-shot-dots" aria-hidden="true">
              {PHONE_WELCOME_SHOTS.map((s, i) => <i key={s.src} className={i === shot ? 'is-active' : ''} />)}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="pw-panel pw-ready">
            <div className="pw-mark pw-mark--ok" aria-hidden="true"><Check size={30} strokeWidth={2.2} /></div>
            <h1 ref={headingRef} tabIndex={-1}>Tout est prêt</h1>
            <p className="pw-lead">Thème : <strong>{themeLabel}</strong>. Vos choix sont enregistrés sur ce téléphone.</p>
            <div className="pw-tour-note" role="note">
              <span className="pw-tour-ico" aria-hidden="true"><Compass size={18} strokeWidth={2} /></span>
              <span>
                <strong>Visite guidée mobile</strong>
                <small>Elle démarre à l’ouverture : accueil, barre du bas, scan, menu rapide, Atlas Agent et profil. C’est une simple démonstration : elle n’ajoute rien à votre base de données et vous pouvez la passer à tout moment.</small>
              </span>
            </div>
            <button type="button" className="pw-skip-tour" onClick={() => finish(false)}>Ouvrir sans la visite</button>
          </section>
        )}
      </main>

      <footer className={`pw-foot${step === 0 ? ' pw-foot--single' : ''}`}>
        {step > 0 ? (
          <button type="button" className="pw-btn pw-btn--ghost" onClick={() => go(step - 1)} aria-label="Étape précédente">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        ) : null}
        {step < LAST ? (
          <button type="button" className="pw-btn pw-btn--primary" onClick={() => go(step + 1)}>
            {step === 0 ? 'Commencer' : 'Continuer'} <ArrowRight size={18} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="pw-btn pw-btn--primary" onClick={() => finish(true)}>
            Ouvrir Atlas <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
      </footer>
    </div>
  );
}
