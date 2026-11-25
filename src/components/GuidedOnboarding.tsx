/**
 * v0.9.3 — Visite guidée interactive, lancée après « Explorer Atlas Commerce »
 * (dernière étape du guide de bienvenue).
 *
 * Chaque étape ouvre la bonne page, entoure l’élément concerné (projecteur) et
 * explique à quoi il sert : Produits → Ajouter un produit, Clients → Ajouter un
 * client, Factures → Créer une facture, Vente rapide, Solde, Atlas Agent, menu
 * du compte.
 *
 * C’est une simple démonstration : un écran transparent (.ac-onboard-shield)
 * bloque les clics sur la page pendant la visite, aucun appel API n’est fait et
 * rien n’est ajouté à la base de données. « Passer » (ou Échap) la quitte à tout
 * moment. Seules la progression et la fin sont gardées dans localStorage
 * (src/lib/onboarding.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import { FloatingPortal } from './FloatingPortal';
import {
  finishOnboarding,
  getOnboarding,
  ONBOARDING_EVENT,
  setOnboardingStep,
} from '../lib/onboarding';

export type OnboardingStep = {
  id: string;
  /** Page to open for this step (null = stay where the user is). */
  route: string | null;
  /** CSS selector of the element to spotlight (first visible match). */
  target: string;
  title: string;
  body: string;
  /** Short call to action shown under the body. */
  hint?: string;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'dashboard',
    route: '/dashboard',
    target: '.ac-dash-hero',
    title: 'Votre tableau de bord',
    body: 'Chiffre d’affaires, encaissements, stock bas et prochaines actions : tout part d’ici. Changez la période avec 7j · 1m · 6m · 1a.',
  },
  {
    id: 'sidebar-products',
    route: '/dashboard',
    target: 'aside a[href="/products"]',
    title: 'Allez dans Produits',
    body: 'Toutes les pages sont dans la barre latérale. Commençons par le catalogue : Produits & stock.',
    hint: 'C’est ici que vous cliquerez ensuite. Appuyez sur Suivant.',
  },
  {
    id: 'product-create',
    route: '/products',
    target: 'button[title="Ajouter un produit"]',
    title: 'Créez votre premier produit',
    body: 'Nom, prix, stock, catégorie et code-barres, en quelques étapes. Le stock se met ensuite à jour tout seul à chaque vente.',
    hint: 'Ce bouton ouvre l’assistant produit. Ici, rien n’est créé : appuyez sur Suivant.',
  },
  {
    id: 'client-create',
    route: '/clients',
    target: 'button[title="Ajouter un client"]',
    title: 'Ajoutez un client',
    body: 'ICE, téléphone et adresse : la fiche sert ensuite aux devis, aux factures et aux relances d’impayés.',
    hint: 'Vous le ferez plus tard depuis ce bouton. Appuyez sur Suivant.',
  },
  {
    id: 'invoice-create',
    route: '/invoices',
    target: 'button[title="Créer une facture"]',
    title: 'Créez une facture',
    body: 'Choisissez le client et les produits : la TVA, le stock et le PDF sont calculés pour vous.',
    hint: 'Vous le ferez plus tard depuis ce bouton. Appuyez sur Suivant.',
  },
  {
    id: 'quick-sale',
    route: '/quick-sale',
    target: 'button[title="Nouvelle vente"]',
    title: 'Encaissez une vente rapide',
    body: 'Pour le comptoir : un ticket, un paiement, et le stock comme la caisse sont à jour.',
    hint: 'Vous le ferez plus tard depuis ce bouton. Appuyez sur Suivant.',
  },
  {
    id: 'balance',
    route: '/balance',
    target: '.balance-page .ac-metric-grid',
    title: 'Suivez votre caisse',
    body: 'Recettes, dépenses, apports, prélèvements et rapprochement : le solde reste toujours cohérent.',
  },
  {
    id: 'agent',
    route: null,
    target: '.atlas-agent-fab',
    title: 'Demandez à Atlas Agent',
    body: '« Nouveau client », « Rapport du jour », « Dépense de 200 DH »… L’agent prépare l’action, vous la confirmez.',
  },
  {
    id: 'account',
    route: null,
    target: '.ac-topbar-user-btn',
    title: 'Votre compte et les paramètres',
    body: 'Paramètres, Nouveautés, À propos et Déconnexion sont dans ce menu. Vous pourrez revoir cette visite depuis Paramètres → Mon profil.',
  },
];

const CARD_W = 340;
const GAP = 14;
const PAD = 6;

/** Any blocking window open (wizard, modal, Nouveautés…) hides the tour card. */
const BLOCKING = '.modal-overlay, .whats-new-modal-backdrop, [aria-modal="true"]:not(.ac-onboard-card)';
/** Page still loading: skeletons / shimmer placeholders in the main column. */
const LOADING = '.content .skeleton, .content [aria-busy="true"], main .skeleton, main [aria-busy="true"]';
const TICK_MS = 120;
/** Same target rect on this many consecutive checks = settled (~360 ms). */
const SETTLE_TICKS = 3;
/** Never wait longer than this before showing the card. */
const MAX_SETTLE_MS = 4000;

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(selector: string): HTMLElement | null {
  const list = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const el of list) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function placeCard(rect: Rect | null, cardH: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(12, Math.min(vw - CARD_W - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(vh - cardH - 12, y));
  if (!rect) return { top: clampY((vh - cardH) / 2), left: clampX((vw - CARD_W) / 2) };
  // Narrow target on the left edge (sidebar) → card on its right.
  if (rect.left < 120 && rect.width < 120) {
    return { top: clampY(rect.top + rect.height / 2 - cardH / 2), left: clampX(rect.left + rect.width + GAP + PAD) };
  }
  const below = rect.top + rect.height + GAP + PAD;
  if (below + cardH < vh - 12) return { top: below, left: clampX(rect.left + rect.width / 2 - CARD_W / 2) };
  const above = rect.top - GAP - PAD - cardH;
  if (above > 12) return { top: above, left: clampX(rect.left + rect.width / 2 - CARD_W / 2) };
  // Tall target (or near the bottom-right FAB) → card on its left.
  return { top: clampY(rect.top + rect.height / 2 - cardH / 2), left: clampX(rect.left - CARD_W - GAP - PAD) };
}

export function GuidedOnboarding({ steps = ONBOARDING_STEPS }: { steps?: OnboardingStep[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState(() => getOnboarding());
  const [rect, setRect] = useState<Rect | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const active = state?.status === 'pending';
  const index = active ? Math.min(state.step, steps.length - 1) : 0;
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    const sync = () => setState(getOnboarding());
    window.addEventListener(ONBOARDING_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ONBOARDING_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Open the step's page once, when the step changes (the user stays free to browse).
  const routedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !step) return;
    if (routedFor.current === step.id) return;
    routedFor.current = step.id;
    if (step.route && location.pathname !== step.route) navigate(step.route);
  }, [active, step, location.pathname, navigate]);

  // Track the target (pages load lazily, the dock animates, the user scrolls).
  // The card stays invisible until the target has settled: no skeleton/shimmer left
  // on the page and the same position on a few consecutive checks. Before, the card
  // showed centred while the page shimmered, then jumped next to the target.
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (!active || !step) return undefined;
    setPlaced(false);
    setRect(null);
    const startedAt = Date.now();
    let scrolled = false;
    let stableTicks = 0;
    let prevRect: Rect | null = null;
    let done = false;
    const measure = () => {
      setBlocked(Boolean(document.querySelector(BLOCKING)));
      const el = findTarget(step.target);
      const waited = Date.now() - startedAt;
      if (!el) {
        prevRect = null;
        stableTicks = 0;
        setRect(null);
        // Target never appeared (role without that page, slow network): centred card.
        if (!done && waited > MAX_SETTLE_MS) { done = true; setPlaced(true); }
        return;
      }
      if (!scrolled) {
        scrolled = true;
        const r0 = el.getBoundingClientRect();
        if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      }
      const r = el.getBoundingClientRect();
      const next: Rect = { top: r.top, left: r.left, width: r.width, height: r.height };
      const same = !!prevRect && Math.abs(prevRect.top - next.top) < 0.5 && Math.abs(prevRect.left - next.left) < 0.5
        && Math.abs(prevRect.width - next.width) < 0.5 && Math.abs(prevRect.height - next.height) < 0.5;
      stableTicks = same ? stableTicks + 1 : 0;
      prevRect = next;
      setRect((prev) =>
        prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5
          ? prev
          : next,
      );
      if (!done) {
        const shimmering = Boolean(document.querySelector(LOADING));
        if ((stableTicks >= SETTLE_TICKS && !shimmering) || waited > MAX_SETTLE_MS) {
          done = true;
          setPlaced(true);
        }
      }
    };
    measure();
    const id = window.setInterval(measure, TICK_MS);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, step]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  });

  useEffect(() => {
    if (active && !blocked && placed) nextRef.current?.focus({ preventScroll: true });
  }, [active, blocked, index, placed]);

  const go = useCallback((n: number) => {
    if (n >= steps.length) {
      finishOnboarding();
      return;
    }
    setOnboardingStep(Math.max(0, n));
  }, [steps.length]);

  const skip = useCallback(() => finishOnboarding(), []);

  useEffect(() => {
    if (!active || blocked) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, blocked, skip]);

  if (!active || !step || blocked) return null;

  const pos = placeCard(rect, cardH);
  const titleId = `ac-onboard-title-${step.id}`;

  return (
    <FloatingPortal>
      <div className="ac-onboard-layer" data-step={step.id}>
        {/* Demo only: swallow every click on the page so the tour can never create data. */}
        <div className="ac-onboard-shield" aria-hidden="true" />
        {!placed ? null : rect ? (
          <div
            className="ac-onboard-spot"
            aria-hidden="true"
            style={{
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
            }}
          />
        ) : (
          <div className="ac-onboard-dim" aria-hidden="true" />
        )}
        <div
          ref={cardRef}
          className={`ac-onboard-card${placed ? ' is-placed' : ''}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-hidden={placed ? undefined : true}
          style={{ top: pos.top, left: pos.left, width: CARD_W }}
        >
          <div className="ac-onboard-head">
            <span className="ac-onboard-kicker">
              <Compass size={14} strokeWidth={2} aria-hidden="true" />
              Visite guidée · {index + 1} / {steps.length}
            </span>
            <button type="button" className="ac-onboard-close" aria-label="Quitter la visite" onClick={skip}>
              <X size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <h2 id={titleId} className="ac-onboard-title">{step.title}</h2>
          <p className="ac-onboard-body">{step.body}</p>
          {step.hint ? <p className="ac-onboard-hint">{step.hint}</p> : null}
          <p className="ac-onboard-demo">
            Démonstration uniquement : rien n’est ajouté à votre base de données. Vous pouvez passer la visite à tout moment.
          </p>
          <div className="ac-onboard-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={`ac-onboard-dot${i === index ? ' is-active' : ''}${i < index ? ' is-done' : ''}`} />
            ))}
          </div>
          <div className="ac-onboard-foot">
            <button type="button" className="ac-onboard-skip" onClick={skip} title="Passer la visite guidée">
              Passer
            </button>
            <div className="ac-onboard-nav">
              {index > 0 ? (
                <button type="button" className="ac-onboard-btn ac-onboard-btn--ghost" onClick={() => go(index - 1)}>
                  <ArrowLeft size={15} aria-hidden="true" /> Précédent
                </button>
              ) : null}
              <button ref={nextRef} type="button" className="ac-onboard-btn ac-onboard-btn--primary" onClick={() => go(index + 1)}>
                {last ? (
                  <>Terminer <Check size={15} aria-hidden="true" /></>
                ) : (
                  <>Suivant <ArrowRight size={15} aria-hidden="true" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}

export default GuidedOnboarding;
