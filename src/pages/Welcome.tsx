import { WelcomePreview } from '../components/WelcomePreview';
import { FeatureTour } from '../components/ui/FeatureTour';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Boxes,
  Check,
  Compass,
  FileText,
  Globe,
  LayoutGrid,
  Package,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
/**
 * Full-screen Atlas Commerce welcome — Bento UI onboarding, theme & density,
 * real captures, comparisons, and optional interactive feature tour.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WELCOME_STEP_COUNT,
  WELCOME_PREVIEW_START,
  WELCOME_FEATURES_STEP,
  WELCOME_COMPARE_STEP,
  WELCOME_FINAL_STEP,
  getWelcomePrefs,
  getWelcomeStep,
  isWelcomeCompleted,
  markWelcomeCompleted,
  saveWelcomePrefs,
  setWelcomeStep,
  type WelcomeDensity,
  type WelcomePrefs,
  type WelcomeTheme,
} from '../lib/welcome';
import { setDensity, setGlassEnabled } from '../lib/density';
import {
  APP_CREATOR,
  APP_CREATOR_NAME,
  APP_GITHUB,
  APP_NAME,
  APP_VERSION,
} from '../version';

function applyThemeMode(mode: WelcomeTheme) {
  try {
    localStorage.setItem('atlas-theme', mode);
  } catch {
    /* */
  }
  const resolved =
    mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : mode;
  document.documentElement.setAttribute('data-theme', resolved);
}

/** Bento dashboard wireframe matching the Focus sidebar + floating dock + 4-KPI Bento grid. */
function ThemeMock({ mode }: { mode: WelcomeTheme }) {
  if (mode === 'system') {
    return (
      <div className="welcome-pick-preview" data-theme-preview="system">
        <svg viewBox="0 0 180 112" className="welcome-mock-svg" aria-hidden>
          <defs>
            <clipPath id="welcome-sys-right">
              <rect x="90" y="0" width="90" height="112" />
            </clipPath>
          </defs>
          {/* Light left half */}
          <rect width="180" height="112" rx="10" fill="#f5f6f8" />
          <rect x="8" y="8" width="34" height="96" rx="8" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
          <rect x="13" y="16" width="24" height="6" rx="3" fill="#0f172a" opacity="0.85" />
          <rect x="13" y="28" width="24" height="5" rx="2.5" fill="#cbd5e1" />
          <rect x="13" y="37" width="20" height="5" rx="2.5" fill="#cbd5e1" />
          <rect x="13" y="46" width="24" height="5" rx="2.5" fill="#cbd5e1" />
          <rect x="74" y="8" width="60" height="12" rx="6" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={`l-${i}`} x={50 + i * 31} y="26" width="27" height="24" rx="6" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
          ))}
          <rect x="50" y="56" width="76" height="48" rx="8" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
          <path d="M58 92 C68 85, 76 72, 88 76 S106 86, 118 68" fill="none" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
          {/* Dark right half */}
          <g clipPath="url(#welcome-sys-right)">
            <rect width="180" height="112" rx="10" fill="#111113" />
            <rect x="74" y="8" width="60" height="12" rx="6" fill="#1c1c1f" stroke="#2a2a2e" strokeWidth="1" />
            {[0, 1, 2, 3].map((i) => (
              <rect key={`d-${i}`} x={50 + i * 31} y="26" width="27" height="24" rx="6" fill="#1c1c1f" stroke="#2a2a2e" strokeWidth="1" />
            ))}
            <rect x="50" y="56" width="76" height="48" rx="8" fill="#1c1c1f" stroke="#2a2a2e" strokeWidth="1" />
            <path d="M58 92 C68 85, 76 72, 88 76 S106 86, 118 68" fill="none" stroke="#e4e4e7" strokeWidth="1.8" strokeLinecap="round" />
            <rect x="132" y="56" width="40" height="48" rx="8" fill="#1c1c1f" stroke="#2a2a2e" strokeWidth="1" />
            <rect x="138" y="64" width="28" height="4" rx="2" fill="#e4e4e7" opacity="0.8" />
            <rect x="138" y="73" width="24" height="4" rx="2" fill="#52525b" />
            <rect x="138" y="82" width="28" height="4" rx="2" fill="#52525b" />
          </g>
          <line x1="90" y1="0" x2="90" y2="112" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
        </svg>
      </div>
    );
  }
  const isDark = mode === 'dark';
  const bg = isDark ? '#111113' : '#f5f6f8';
  const card = isDark ? '#1c1c1f' : '#ffffff';
  const line = isDark ? '#2a2a2e' : '#e2e8f0';
  const accent = isDark ? '#e4e4e7' : '#0f172a';
  const muted = isDark ? '#52525b' : '#cbd5e1';
  return (
    <div className="welcome-pick-preview" data-theme-preview={isDark ? 'dark' : 'light'}>
      <svg viewBox="0 0 180 112" className="welcome-mock-svg" aria-hidden>
        <rect width="180" height="112" rx="10" fill={bg} />
        {/* Floating Bento sidebar */}
        <rect x="8" y="8" width="34" height="96" rx="8" fill={card} stroke={line} strokeWidth="1" />
        <rect x="13" y="16" width="24" height="6" rx="3" fill={accent} opacity="0.85" />
        <rect x="13" y="28" width="24" height="5" rx="2.5" fill={muted} />
        <rect x="13" y="37" width="20" height="5" rx="2.5" fill={muted} />
        <rect x="13" y="46" width="24" height="5" rx="2.5" fill={muted} />
        {/* Floating centered dock */}
        <rect x="74" y="8" width="60" height="12" rx="6" fill={card} stroke={line} strokeWidth="1" />
        <rect x="82" y="12.5" width="26" height="3" rx="1.5" fill={accent} opacity="0.85" />
        <circle cx="126" cy="14" r="2.5" fill={muted} />
        {/* 4 Bento KPI tiles */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect
              x={50 + i * 31}
              y="26"
              width="27"
              height="24"
              rx="6"
              fill={card}
              stroke={line}
              strokeWidth="1"
            />
            <rect x={54 + i * 31} y="32" width="12" height="3" rx="1.5" fill={muted} />
            <rect x={54 + i * 31} y="39" width="17" height="5" rx="2" fill={accent} opacity="0.85" />
          </g>
        ))}
        {/* 2 Bento main panels */}
        <rect x="50" y="56" width="76" height="48" rx="8" fill={card} stroke={line} strokeWidth="1" />
        <path
          d="M58 92 C68 85, 76 72, 88 76 S106 86, 118 68"
          fill="none"
          stroke={accent}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <rect x="132" y="56" width="40" height="48" rx="8" fill={card} stroke={line} strokeWidth="1" />
        <rect x="138" y="64" width="28" height="4" rx="2" fill={accent} opacity="0.8" />
        <rect x="138" y="73" width="24" height="4" rx="2" fill={muted} />
        <rect x="138" y="82" width="28" height="4" rx="2" fill={muted} />
        <rect x="138" y="91" width="19" height="4" rx="2" fill={muted} />
      </svg>
    </div>
  );
}

const WELCOME_FEATURES = [
  {
    title: 'Stock & entrepôts',
    blurb: 'Produits, alertes seuils bas, transferts multi-dépôts, inventaire et historique 90 jours.',
    pages: 'Produits · Opérations stock',
    Icon: Boxes,
  },
  {
    title: 'Ventes FA / VR / Devis',
    blurb: 'Factures, ventes rapides, devis convertibles en 1 clic et numérotation atomique.',
    pages: 'Factures · Vente rapide · Devis',
    Icon: FileText,
  },
  {
    title: 'Achats & scan OCR IA',
    blurb: 'Factures d’achat en 3 étapes avec lecture automatique par vision IA Qwen et contrôle.',
    pages: 'Factures d’achat · Fournisseurs',
    Icon: ScanLine,
  },
  {
    title: 'Clients & crédit',
    blurb: 'Fiches, ICE, soldes, plafonds de crédit, situation client et suivi des règlements.',
    pages: 'Clients · Situation client',
    Icon: Users,
  },
  {
    title: 'Solde & caisse X / Z',
    blurb: 'Recettes, dépenses, apports, prélèvements et clôtures de caisse X / Z contrôlées.',
    pages: 'Solde · Clôtures X / Z',
    Icon: Wallet,
  },
  {
    title: 'Employés & paie',
    blurb: 'Présences, acomptes, bulletins et déclarations CNSS / AMO depuis un seul espace.',
    pages: 'Employés · Paie CNSS / AMO',
    Icon: BadgeCheck,
  },
  {
    title: 'Atlas Agent IA',
    blurb: 'Assistant connecté aux outils métier pour créer, chercher et analyser vos données.',
    pages: 'Agent (panneau latéral)',
    Icon: Bot,
  },
  {
    title: 'Sécurité & audit',
    blurb: 'Rôles, passkeys WebAuthn, OTP nouvel appareil, journal d’audit et sauvegardes.',
    pages: 'Paramètres · Journal d’audit',
    Icon: ShieldCheck,
  },
  {
    title: 'Mobile & terrain',
    blurb: 'App téléphone pour scanner et proposer des actions validées ensuite sur le bureau.',
    pages: 'App téléphone · Boîte d’actions',
    Icon: Smartphone,
  },
  {
    title: 'Rapports & TVA',
    blurb: 'Balance âgée, récapitulatif TVA, coût des ventes (COGS) et clôture de période.',
    pages: 'Rapports · Tableau de bord',
    Icon: BarChart3,
  },
  {
    title: 'Interface Bento & Focus',
    blurb: 'Dock adaptatif qui s’efface au défilement et barre latérale Focus sur les réglages.',
    pages: 'Navigation · Paramètres',
    Icon: LayoutGrid,
  },
  {
    title: 'Contexte Maroc',
    blurb: 'HT / TTC, TVA multi-taux, ICE / RC / Patente, dirhams (MAD) et mentions légales.',
    pages: 'Légal & TVA · Documents PDF',
    Icon: Globe,
  },
] as const;

function ComparePaperVsAtlas() {
  return (
    <div className="welcome-compare-pair">
      <div className="welcome-compare-side legacy">
        <span className="welcome-compare-badge bad">Papier / calculatrice</span>
        <svg viewBox="0 0 200 140" className="welcome-scene-svg" aria-hidden>
          <defs>
            <filter id="paper-wrinkle">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="2" />
            </filter>
          </defs>
          <rect x="18" y="16" width="100" height="110" rx="4" fill="#f3e9d4" stroke="#c4b089" strokeWidth="1.2" filter="url(#paper-wrinkle)" />
          <line x1="34" y1="16" x2="34" y2="126" stroke="#e0c9a0" strokeWidth="2" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <line key={i} x1="42" y1={32 + i * 14} x2="108" y2={34 + i * 14} stroke="#8a7a5c" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" className="welcome-ink-line" style={{ animationDelay: `${i * 0.35}s` }} />
          ))}
          <path d="M48 48 L96 52 M50 50 L94 46" stroke="#b33" strokeWidth="1.4" opacity="0.7" className="welcome-scratch" />
          <circle cx="88" cy="78" r="6" fill="#3a2a1a" opacity="0.15" className="welcome-ink-blot" />
          <rect x="128" y="40" width="56" height="72" rx="6" fill="#2a2a2a" stroke="#111" />
          <rect x="134" y="48" width="44" height="16" rx="2" fill="#1a1d26" />
          <text x="156" y="60" textAnchor="middle" fill="#e2e8f0" fontSize="9" fontFamily="monospace" className="welcome-calc-err">
            Err
          </text>
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => (
              <rect key={`${r}-${c}`} x={134 + c * 15} y={72 + r * 12} width="12" height="9" rx="1.5" fill="#444" className="welcome-calc-key" style={{ animationDelay: `${(r * 3 + c) * 0.2}s` }} />
            ))
          )}
        </svg>
        <p className="welcome-compare-caption">Erreurs raturées, calculs lents, stock inventé.</p>
      </div>
      <div className="welcome-compare-vs" aria-hidden>
        →
      </div>
      <div className="welcome-compare-side atlas">
        <span className="welcome-compare-badge good">Atlas Commerce</span>
        <svg viewBox="0 0 200 140" className="welcome-scene-svg" aria-hidden>
          <defs>
            <linearGradient id="laser" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#71717a" stopOpacity="0" />
              <stop offset="50%" stopColor="#e2e8f0" stopOpacity="1" />
              <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="24" y="48" width="70" height="44" rx="6" fill="#12141a" stroke="#64748b" />
          <rect x="32" y="56" width="54" height="8" rx="2" fill="#0b0e14" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <rect key={i} x={34 + i * 5.5} y="68" width={i % 3 === 0 ? 2.5 : 1.5} height="16" fill="#e8f5f0" opacity="0.85" />
          ))}
          <rect x="20" y="62" width="80" height="3" fill="url(#laser)" className="welcome-laser" />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={100 + i * 8} cy={70 - i * 2} r="1.6" fill="#71717a" className="welcome-particle" style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
          <rect x="118" y="28" width="68" height="84" rx="8" fill="#0b0e14" stroke="#71717a" strokeWidth="1.2" />
          <text x="152" y="46" textAnchor="middle" fill="#a1a1aa" fontSize="8" fontWeight="600">
            Ledger
          </text>
          <rect x="128" y="54" width="48" height="5" rx="2" fill="#64748b" className="welcome-ledger-bar" />
          <rect x="128" y="64" width="36" height="4" rx="2" fill="#1a1d26" />
          <rect x="128" y="74" width="42" height="4" rx="2" fill="#1a1d26" />
          <text x="152" y="98" textAnchor="middle" fill="#e2e8f0" fontSize="11" fontFamily="monospace" className="welcome-ledger-sum">
            1 240 DH
          </text>
        </svg>
        <p className="welcome-compare-caption">Scan laser, sync instantanée, solde automatique.</p>
      </div>
    </div>
  );
}

function CompareErpVsAtlas() {
  return (
    <div className="welcome-compare-pair">
      <div className="welcome-compare-side legacy">
        <span className="welcome-compare-badge bad">Excel / ERP lourd</span>
        <svg viewBox="0 0 200 140" className="welcome-scene-svg" aria-hidden>
          <rect x="10" y="12" width="180" height="116" rx="4" fill="#1e1e1e" stroke="#333" />
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={`h${i}`} x={14 + i * 15} y="16" width="14" height="10" fill="#2a3040" opacity="0.8" />
          ))}
          {Array.from({ length: 8 }).map((_row, r) =>
            Array.from({ length: 12 }).map((_col, c) => (
              <rect
                key={`${r}-${c}`}
                x={14 + c * 15}
                y={30 + r * 11}
                width="14"
                height="10"
                fill={r === 3 && c === 5 ? '#4a1a1a' : '#252525'}
                stroke="#333"
                strokeWidth="0.4"
              />
            ))
          )}
          <text x="100" y="72" textAnchor="middle" fill="#ff6b6b" fontSize="9" fontFamily="monospace" className="welcome-value-err">
            #VALUE!
          </text>
          <circle cx="100" cy="100" r="10" fill="none" stroke="#666" strokeWidth="2" strokeDasharray="12 8" className="welcome-spin" />
        </svg>
        <p className="welcome-compare-caption">50 colonnes, formules cassées, interface figée.</p>
      </div>
      <div className="welcome-compare-vs" aria-hidden>
        →
      </div>
      <div className="welcome-compare-side atlas">
        <span className="welcome-compare-badge good">Bento Atlas Commerce</span>
        <svg viewBox="0 0 200 140" className="welcome-scene-svg" aria-hidden>
          <rect x="12" y="12" width="176" height="116" rx="10" fill="#0b0e14" />
          <rect x="22" y="22" width="48" height="18" rx="9" fill="#12141a" stroke="#64748b" className="welcome-pill" />
          <rect x="76" y="22" width="48" height="18" rx="9" fill="#12141a" stroke="#64748b" className="welcome-pill" style={{ animationDelay: '0.15s' }} />
          <rect x="130" y="22" width="48" height="18" rx="9" fill="#12141a" stroke="#64748b" className="welcome-pill" style={{ animationDelay: '0.3s' }} />
          <path
            d="M28 100 C48 90, 58 70, 78 75 S108 110, 128 85 S158 60, 178 55"
            fill="none"
            stroke="#a1a1aa"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="welcome-chart-path"
          />
          <circle cx="178" cy="55" r="3.5" fill="#e2e8f0" className="welcome-chart-dot" />
          <rect x="22" y="112" width="70" height="6" rx="2" fill="#1a1d26" className="welcome-feed" />
          <rect x="98" y="112" width="50" height="6" rx="2" fill="#64748b" className="welcome-feed" style={{ animationDelay: '0.2s' }} />
        </svg>
        <p className="welcome-compare-caption">Vue Bento claire, flux en direct, zéro friction.</p>
      </div>
    </div>
  );
}

function MasteryTips() {
  const tips = [
    {
      title: 'OCR & assistants guidés',
      body: 'Déposez une facture fournisseur : Qwen Vision pré-remplit lignes, montants et TVA étape par étape.',
      Icon: ScanLine,
    },
    {
      title: 'Dock & navigation Focus',
      body: 'Les barres hautes se minimisent au défilement et se déplient au survol ; la barre Focus isole les réglages.',
      Icon: LayoutGrid,
    },
    {
      title: 'Mobile → Bureau en direct',
      body: 'Scannez depuis l’app téléphone : la boîte d’actions du PC reçoit et valide chaque mouvement.',
      Icon: Smartphone,
    },
  ];
  return (
    <div className="welcome-mastery">
      <h3 className="welcome-mastery-title">Réflexes Bento à connaître</h3>
      <div className="welcome-mastery-grid">
        {tips.map(({ title, body, Icon }, i) => (
          <article key={title} className="welcome-mastery-card" style={{ animationDelay: `${0.08 + i * 0.08}s` }}>
            <div className="welcome-mastery-icon" aria-hidden="true">
              <Icon size={18} strokeWidth={1.9} />
            </div>
            <h4>{title}</h4>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function Welcome() {
  const navigate = useNavigate();
  const [showTour, setShowTour] = useState(false);
  const tourSteps = useMemo(
    () => [
      {
        id: 'stock',
        title: 'Stock & produits',
        description: 'Catalogue, seuils bas, transferts inter-entrepôts, inventaire et historique.',
        icon: <Package size={40} strokeWidth={1.5} />,
      },
      {
        id: 'sales',
        title: 'Ventes, achats & OCR',
        description: 'Devis, factures, ventes rapides et scan OCR des factures d’achat.',
        icon: <FileText size={40} strokeWidth={1.5} />,
      },
      {
        id: 'people',
        title: 'Clients, équipe & paie',
        description: 'Fiches clients, employés, présences, acomptes et bulletins CNSS / AMO.',
        icon: <Users size={40} strokeWidth={1.5} />,
      },
      {
        id: 'agent',
        title: 'Atlas Agent IA',
        description: 'Assistant connecté aux outils métier pour créer, chercher et résumer.',
        icon: <Bot size={40} strokeWidth={1.5} />,
      },
      {
        id: 'reports',
        title: 'Pilotage Bento',
        description: 'Tableau de bord, clôtures X / Z, rapports TVA / COGS et clôture de période.',
        icon: <BarChart3 size={40} strokeWidth={1.5} />,
      },
    ],
    [],
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(() => getWelcomeStep());
  const [prefs, setPrefs] = useState<WelcomePrefs>(() => getWelcomePrefs());
  const [showNext, setShowNext] = useState(step !== 0);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [compareTab, setCompareTab] = useState<'paper' | 'erp'>('paper');

  useEffect(() => {
    if (isWelcomeCompleted()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  useEffect(() => {
    setWelcomeStep(step);
    window.scrollTo({ top: 0, behavior: 'instant' });
    const heading = panelRef.current?.querySelector<HTMLElement>('h1, h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [step]);

  useEffect(() => {
    applyThemeMode(prefs.theme);
    setDensity(prefs.density);
    setGlassEnabled(false);
  }, [prefs]);

  useEffect(() => {
    if (step !== 0) {
      setShowNext(true);
      return;
    }
    setShowNext(false);
    const t = window.setTimeout(() => setShowNext(true), 900);
    return () => window.clearTimeout(t);
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/users/${APP_CREATOR}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ avatar_url?: string }>) : null))
      .then((u) => {
        if (!cancelled && u?.avatar_url) setAvatar(String(u.avatar_url));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback((next: number) => {
    setStep(Math.max(0, Math.min(WELCOME_STEP_COUNT - 1, next)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showTour || e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.closest('button, a, [role="tab"]') ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          (t.tagName === 'INPUT' &&
            (t as HTMLInputElement).type !== 'checkbox' &&
            (t as HTMLInputElement).type !== 'radio' &&
            (t as HTMLInputElement).type !== 'button'))
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (leaving) return;
      if (step === 0 && !showNext) return;
      if (step >= WELCOME_STEP_COUNT - 1) {
        (document.querySelector('.welcome-cta-glow, .welcome-cta') as HTMLButtonElement | null)?.click();
        return;
      }
      go(step + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, showNext, leaving, showTour, go]);

  const pickTheme = (theme: WelcomeTheme) => {
    setPrefs(saveWelcomePrefs({ theme }));
    applyThemeMode(theme);
  };

  const pickDensity = (density: WelcomeDensity) => {
    setPrefs(saveWelcomePrefs({ density }));
    setDensity(density);
  };

  const finish = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    applyThemeMode(prefs.theme);
    setDensity(prefs.density);
    setGlassEnabled(false);
    markWelcomeCompleted();
    window.setTimeout(() => {
      navigate('/dashboard', { replace: true });
    }, 260);
  }, [leaving, navigate, prefs.density, prefs.theme]);

  const progress = useMemo(() => ((step + 1) / WELCOME_STEP_COUNT) * 100, [step]);
  const themeLabel = prefs.theme === 'dark' ? 'Sombre' : prefs.theme === 'light' ? 'Clair' : 'Système';
  const densityLabel = prefs.density === 'comfortable' ? 'Confortable' : 'Compacte';

  return (
    <div className={`welcome-stage${leaving ? ' welcome-leaving' : ''}`} data-step={step}>
      {showTour ? (
        <FeatureTour
          steps={tourSteps}
          onClose={() => setShowTour(false)}
        />
      ) : null}

      <div className="welcome-ambient" aria-hidden />
      <div
        className="welcome-progress"
        role="progressbar"
        aria-label="Progression du guide de bienvenue"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={WELCOME_STEP_COUNT}
      >
        <div className="welcome-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <header className="welcome-top-bar">
        <span className="welcome-brand-pill">
          <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
          <span>{APP_NAME}</span>
          <span className="welcome-ver-tag">v{APP_VERSION}</span>
        </span>
        <span className="welcome-step-pill" aria-live="polite">
          Étape {step + 1} / {WELCOME_STEP_COUNT}
        </span>
        {step < WELCOME_FINAL_STEP ? (
          <button type="button" className="welcome-skip-btn" onClick={finish}>
            Passer l&apos;intro
          </button>
        ) : (
          <span className="welcome-skip-spacer" aria-hidden="true" />
        )}
      </header>

      <div className="welcome-inner" ref={panelRef}>
        {step === 0 && (
          <section className="welcome-panel welcome-hello" key="hello">
            <p className="welcome-kicker">{APP_NAME} · Édition Bento</p>
            <h1 className="welcome-bonjour">
              {'Bonjour'.split('').map((ch, i) => (
                <span key={i} style={{ animationDelay: `${0.06 + i * 0.05}s` }}>
                  {ch}
                </span>
              ))}
            </h1>
            <p className="welcome-sub welcome-fade-late">
              Configurons votre espace — apparence Bento, aperçus réels, caisse X / Z, OCR et pilotage complet de votre activité.
            </p>
            {showNext && (
              <button type="button" className="welcome-cta welcome-cta-glow" onClick={() => go(1)}>
                Commencer <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="welcome-panel welcome-panel-wide" key="theme">
            <h2 className="welcome-title">Choisissez votre apparence</h2>
            <p className="welcome-sub">Aperçu en direct de l&apos;interface Bento et du confort d&apos;affichage.</p>
            <div className="welcome-picks welcome-picks-3">
              {(
                [
                  { id: 'dark' as const, label: 'Sombre', hint: 'Contraste doux pour longues sessions' },
                  { id: 'light' as const, label: 'Clair', hint: 'Surface nette et lisible en magasin' },
                  { id: 'system' as const, label: 'Système', hint: 'Suit automatiquement votre appareil' },
                ] as const
              ).map((opt, i) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`welcome-pick${prefs.theme === opt.id ? ' is-selected' : ''}`}
                  onClick={() => pickTheme(opt.id)}
                  style={{ animationDelay: `${0.05 + i * 0.06}s` }}
                >
                  <ThemeMock mode={opt.id} />
                  <span className="welcome-pick-meta">
                    <span className="welcome-pick-label">{opt.label}</span>
                    <span className="welcome-pick-hint">{opt.hint}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="welcome-density-row" role="group" aria-label="Densité d’affichage">
              <div className="welcome-density-copy">
                <strong>Densité de l&apos;interface</strong>
                <span>Ajustez l&apos;espacement des tableaux et panneaux Bento.</span>
              </div>
              <div className="welcome-density-pills">
                {(
                  [
                    { id: 'comfortable' as const, label: 'Confortable' },
                    { id: 'compact' as const, label: 'Compacte' },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`welcome-density-pill${prefs.density === d.id ? ' is-active' : ''}`}
                    aria-pressed={prefs.density === d.id}
                    onClick={() => pickDensity(d.id)}
                  >
                    {prefs.density === d.id ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(0)}>
                <ArrowLeft size={16} aria-hidden="true" /> Retour
              </button>
              <button type="button" className="welcome-cta" onClick={() => go(2)}>
                Suivant <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {step >= WELCOME_PREVIEW_START && step < WELCOME_FEATURES_STEP && (
          <WelcomePreview
            key={step}
            index={step - WELCOME_PREVIEW_START}
            onPrevious={() => go(step - 1)}
            onNext={() => go(step + 1)}
          />
        )}

        {step === WELCOME_FEATURES_STEP && (
          <section className="welcome-panel welcome-panel-wide" key="features">
            <h2 className="welcome-title">Un écosystème Bento complet</h2>
            <p className="welcome-sub">Stock, ventes, achats OCR, caisse X / Z, paie et agent IA — réunis sans complexité.</p>
            <div className="welcome-features-grid">
              {WELCOME_FEATURES.map(({ title, blurb, pages, Icon }, i) => (
                <article
                  key={title}
                  className="welcome-feature-card"
                  style={{ animationDelay: `${0.03 + i * 0.025}s` }}
                >
                  <div className="welcome-feature-icon" aria-hidden="true">
                    <Icon size={20} strokeWidth={1.85} />
                  </div>
                  <div className="welcome-feature-body">
                    <strong>{title}</strong>
                    <span className="welcome-feature-blurb">{blurb}</span>
                    <span className="welcome-feature-pages">{pages}</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(WELCOME_FEATURES_STEP - 1)}>
                <ArrowLeft size={16} aria-hidden="true" /> Retour
              </button>
              <button type="button" className="welcome-cta" onClick={() => go(WELCOME_COMPARE_STEP)}>
                Suivant <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {step === WELCOME_COMPARE_STEP && (
          <section className="welcome-panel welcome-panel-wide" key="compare">
            <h2 className="welcome-title">Pourquoi {APP_NAME} change la donne</h2>
            <p className="welcome-sub">Comparaisons visuelles et réflexes clés pour démarrer vite.</p>
            <div className="welcome-segment" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={compareTab === 'paper'}
                className={`welcome-seg-btn${compareTab === 'paper' ? ' active' : ''}`}
                onClick={() => setCompareTab('paper')}
              >
                Papier vs Atlas
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={compareTab === 'erp'}
                className={`welcome-seg-btn${compareTab === 'erp' ? ' active' : ''}`}
                onClick={() => setCompareTab('erp')}
              >
                Excel / ERP vs Atlas
              </button>
            </div>
            <div className="welcome-compare-slot">
              {compareTab === 'paper' ? (
                <ComparePaperVsAtlas key="cmp-paper" />
              ) : (
                <CompareErpVsAtlas key="cmp-erp" />
              )}
            </div>
            <MasteryTips />
            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(WELCOME_FEATURES_STEP)}>
                <ArrowLeft size={16} aria-hidden="true" /> Retour
              </button>
              <button type="button" className="welcome-cta" onClick={() => go(WELCOME_FINAL_STEP)}>
                Suivant <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {step === WELCOME_FINAL_STEP && (
          <section className="welcome-panel welcome-panel-wide welcome-close" key="close">
            <p className="welcome-thanks welcome-fade-up">Tout est prêt</p>
            <h2 className="welcome-title welcome-fade-up" style={{ animationDelay: '0.06s' }}>
              Bienvenue dans {APP_NAME}
            </h2>
            <p className="welcome-sub welcome-fade-up" style={{ animationDelay: '0.12s', marginLeft: 'auto', marginRight: 'auto' }}>
              Votre espace Bento est configuré — stock, factures, caisse et pilotage, sous votre contrôle.
            </p>

            <div className="welcome-summary-bento welcome-fade-up" style={{ animationDelay: '0.16s' }}>
              <div className="welcome-summary-chips">
                <span className="welcome-summary-chip">Thème : <strong>{themeLabel}</strong></span>
                <span className="welcome-summary-chip">Densité : <strong>{densityLabel}</strong></span>
                <span className="welcome-summary-chip">Version : <strong>{APP_VERSION}</strong></span>
              </div>
              <button
                type="button"
                className="welcome-tour-trigger"
                onClick={() => setShowTour(true)}
              >
                <Compass size={15} strokeWidth={2} aria-hidden="true" />
                Visite rapide des modules
              </button>
            </div>

            <div className="welcome-creator-badge welcome-fade-up" style={{ animationDelay: '0.22s' }}>
              {avatar ? (
                <img src={avatar} alt="" className="welcome-avatar" width={64} height={64} />
              ) : (
                <div className="welcome-avatar welcome-avatar-fallback">{APP_CREATOR_NAME.slice(0, 1)}</div>
              )}
              <div>
                <p className="welcome-kicker" style={{ opacity: 1, animation: 'none', marginBottom: 4 }}>Créateur</p>
                <h3 className="welcome-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                  {APP_CREATOR_NAME}
                </h3>
                <a href={APP_GITHUB} target="_blank" rel="noreferrer" className="welcome-gh-link">
                  @{APP_CREATOR} · GitHub
                </a>
              </div>
            </div>

            <div className="welcome-projects welcome-fade-up" style={{ animationDelay: '0.28s' }}>
              <p className="welcome-projects-title">Écosystème Atlas</p>
              <div className="welcome-projects-grid">
                <a className="welcome-project-card" href="https://github.com/Etherealmber/atlas-commerce" target="_blank" rel="noreferrer">
                  <strong>atlas-commerce</strong>
                  <span>Web Bento, API Edge &amp; moteur WASM</span>
                </a>
                <a className="welcome-project-card" href="https://github.com/Etherealmber/atlas-commerce-android" target="_blank" rel="noreferrer">
                  <strong>atlas-commerce-android</strong>
                  <span>App Android native</span>
                </a>
                <a className="welcome-project-card" href="https://github.com/Etherealmber/atlas-commerce-desktop" target="_blank" rel="noreferrer">
                  <strong>atlas-commerce-desktop</strong>
                  <span>Client bureau Tauri</span>
                </a>
              </div>
            </div>

            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(WELCOME_COMPARE_STEP)}>
                <ArrowLeft size={16} aria-hidden="true" /> Retour
              </button>
              <button type="button" className="welcome-cta welcome-cta-glow" onClick={finish} disabled={leaving}>
                {leaving ? 'Ouverture…' : 'Explorer Atlas Commerce'} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
