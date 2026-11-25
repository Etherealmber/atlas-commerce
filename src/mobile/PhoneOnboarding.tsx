/**
 * v0.9.3 — Visite guidée « mobile web », lancée après PhoneWelcome.
 *
 * Différences avec la visite bureau (GuidedOnboarding) :
 * - toutes les étapes se passent sur l’accueil /m (aucun changement de page, donc
 *   aucun écran de chargement entre deux étapes) ;
 * - la carte est une feuille pleine largeur collée en haut ou en bas de l’écran,
 *   du côté opposé à l’élément mis en lumière (jamais par-dessus) ;
 * - elle n’apparaît qu’une fois l’élément stable et le squelette de chargement
 *   disparu : pas de carte au centre qui saute ensuite ailleurs.
 *
 * Démonstration uniquement : un écran transparent bloque les touches sur la page,
 * aucun appel API, rien n’est ajouté à la base de données. Progression gardée dans
 * localStorage (`atlas_phone_onboarding`, src/lib/onboarding.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import { FloatingPortal } from '../components/FloatingPortal';
import {
  finishPhoneOnboarding,
  getPhoneOnboarding,
  PHONE_ONBOARDING_EVENT,
  setPhoneOnboardingStep,
} from '../lib/onboarding';
import './phone-welcome.css';

export type PhoneOnboardingStep = {
  id: string;
  /** CSS selector of the element to spotlight (first visible match); null = centred intro. */
  target: string | null;
  title: string;
  body: string;
};

export const PHONE_ONBOARDING_STEPS: PhoneOnboardingStep[] = [
  {
    id: 'home',
    target: '.ph-hero',
    title: 'Votre accueil',
    body: 'Trésorerie ou stock, alertes et derniers documents : l’essentiel de la journée, mis à jour depuis le serveur. Touchez ↻ pour actualiser.',
  },
  {
    id: 'dock',
    target: '.phone-tabbar',
    title: 'La barre du bas',
    body: 'Accueil, Produits, Scan, puis Balance et Employés selon votre rôle. Elle reste visible sur les pages principales.',
  },
  {
    id: 'scan',
    target: '.phone-tabbar .ptab-scan',
    title: 'Scanner un code-barres',
    body: 'Le bouton central ouvre la caméra : la fiche produit, le stock et l’historique s’affichent. Un ajustement part en demande vers le bureau.',
  },
  {
    id: 'quick',
    target: '.ph-quick-ball',
    title: 'Le menu rapide',
    body: 'Notifications et actions en attente, nouvelle vente et clients, en un toucher depuis n’importe quelle page principale.',
  },
  {
    id: 'agent',
    target: '.ph-top-agent',
    title: 'Atlas Agent',
    body: '« Rapport du jour », « Quels articles sont en rupture ? »… L’agent prépare la réponse ou l’action, vous la confirmez.',
  },
  {
    id: 'profile',
    target: '.phone-profile-btn',
    title: 'Profil et réglages',
    body: 'Photo, thème, taille du texte et page d’ouverture. Vous pourrez revoir cette visite depuis Réglages → Visite guidée.',
  },
];

const PAD = 6;
const TICK_MS = 120;
const SETTLE_TICKS = 3;
const MAX_SETTLE_MS = 4000;
const LOADING = '.ph-skeleton-hero, .ph-skeleton-row, .ph-skeleton-tiles, .phone-main .skeleton, .phone-main [aria-busy="true"]';
const BLOCKING = '.ph-modal-bg, .whats-new-modal-backdrop, [aria-modal="true"]:not(.po-card)';

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Card goes on the side of the screen the target is NOT on. */
export function phoneCardSide(rect: Rect | null, viewportHeight: number): 'top' | 'bottom' | 'center' {
  if (!rect) return 'center';
  return rect.top + rect.height / 2 > viewportHeight / 2 ? 'top' : 'bottom';
}

export function PhoneOnboarding({ steps = PHONE_ONBOARDING_STEPS }: { steps?: PhoneOnboardingStep[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState(() => getPhoneOnboarding());
  const [rect, setRect] = useState<Rect | null>(null);
  const [placed, setPlaced] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  const active = state?.status === 'pending';
  const index = active ? Math.min(state.step, steps.length - 1) : 0;
  const step = steps[index];
  const last = index === steps.length - 1;
  const onHome = (location.pathname.replace(/\/+$/, '') || '/m') === '/m';

  useEffect(() => {
    const sync = () => setState(getPhoneOnboarding());
    window.addEventListener(PHONE_ONBOARDING_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PHONE_ONBOARDING_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Every step lives on the home tab: open it once when the tour starts.
  const routed = useRef(false);
  useEffect(() => {
    if (!active) { routed.current = false; return; }
    if (routed.current) return;
    routed.current = true;
    if (!onHome) navigate('/m');
  }, [active, onHome, navigate]);

  useEffect(() => {
    if (!active || !step || !onHome) return undefined;
    setPlaced(false);
    setRect(null);
    // Top-bar targets need the bar expanded (it collapses on scroll).
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    const startedAt = Date.now();
    let stable = 0;
    let prev: Rect | null = null;
    let done = false;
    const measure = () => {
      setBlocked(Boolean(document.querySelector(BLOCKING)));
      const waited = Date.now() - startedAt;
      if (!step.target) {
        if (!done && !document.querySelector(LOADING)) { done = true; setPlaced(true); }
        else if (!done && waited > MAX_SETTLE_MS) { done = true; setPlaced(true); }
        return;
      }
      const el = findTarget(step.target);
      if (!el) {
        document.querySelector<HTMLButtonElement>('.ph-top-expand')?.click();
        prev = null;
        stable = 0;
        setRect(null);
        if (!done && waited > MAX_SETTLE_MS) { done = true; setPlaced(true); }
        return;
      }
      const r = el.getBoundingClientRect();
      const next: Rect = { top: r.top, left: r.left, width: r.width, height: r.height };
      const same = !!prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5
        && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5;
      stable = same ? stable + 1 : 0;
      prev = next;
      setRect((p) => (p && same ? p : next));
      if (!done && ((stable >= SETTLE_TICKS && !document.querySelector(LOADING)) || waited > MAX_SETTLE_MS)) {
        done = true;
        setPlaced(true);
      }
    };
    measure();
    const id = window.setInterval(measure, TICK_MS);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [active, step, onHome]);

  useEffect(() => {
    if (active && placed && !blocked) nextRef.current?.focus({ preventScroll: true });
  }, [active, placed, blocked, index]);

  const go = useCallback((n: number) => {
    if (n >= steps.length) { finishPhoneOnboarding(); return; }
    setPhoneOnboardingStep(Math.max(0, n));
  }, [steps.length]);
  const skip = useCallback(() => finishPhoneOnboarding(), []);

  if (!active || !step || blocked || !onHome) return null;

  const side = placed ? phoneCardSide(rect, window.innerHeight) : 'bottom';
  const titleId = `po-title-${step.id}`;

  return (
    <FloatingPortal>
      <div className="po-layer" data-step={step.id}>
        {/* Demo only: the page underneath cannot be touched, so nothing can be created. */}
        <div className="po-shield" aria-hidden="true" />
        {placed ? (rect ? (
          <div
            className="po-spot"
            aria-hidden="true"
            style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          />
        ) : <div className="po-dim" aria-hidden="true" />) : null}
        <div
          className={`po-card po-card--${side}${placed ? ' is-placed' : ''}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-hidden={placed ? undefined : true}
        >
          <div className="po-head">
            <span className="po-kicker"><Compass size={14} strokeWidth={2} aria-hidden="true" /> Visite guidée · {index + 1} / {steps.length}</span>
            <button type="button" className="po-close" aria-label="Quitter la visite" onClick={skip}><X size={18} strokeWidth={2.2} aria-hidden="true" /></button>
          </div>
          <h2 id={titleId} className="po-title">{step.title}</h2>
          <p className="po-body">{step.body}</p>
          <p className="po-demo">Démonstration uniquement : rien n’est ajouté à votre base de données. Vous pouvez passer la visite à tout moment.</p>
          <div className="po-dots" aria-hidden="true">
            {steps.map((s, i) => <span key={s.id} className={i === index ? 'is-active' : i < index ? 'is-done' : ''} />)}
          </div>
          <div className="po-foot">
            <button type="button" className="po-btn po-btn--ghost" onClick={skip}>Passer</button>
            <div className="po-nav">
              {index > 0 ? (
                <button type="button" className="po-btn po-btn--ghost po-btn--icon" aria-label="Étape précédente" onClick={() => go(index - 1)}>
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
              ) : null}
              <button ref={nextRef} type="button" className="po-btn po-btn--primary" onClick={() => go(index + 1)}>
                {last ? <>Terminer <Check size={17} aria-hidden="true" /></> : <>Suivant <ArrowRight size={17} aria-hidden="true" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}

export default PhoneOnboarding;
