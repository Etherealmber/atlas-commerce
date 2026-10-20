import { FeatureTour } from '../components/ui/FeatureTour';
import { Package, FileText, Users, Bot, BarChart3 } from 'lucide-react';
/**
 * Full-screen Atlas Commerce welcome — comparison engine, mastery tips, theme/density.
 * No legacy modals. State survives refresh via localStorage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WELCOME_STEP_COUNT,
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
  APP_PROFILE,
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

/** Mini « captures » vectorielles des écrans clés — suivent le thème courant. */
function ScreenShot({ kind }: { kind: 'dash' | 'sale' | 'scan' | 'stock' }) {
  const bars = [20, 44, 32, 58, 40, 66, 50];
  return (
    <svg viewBox="0 0 320 200" className="wshot" aria-hidden>
      <rect x="0.5" y="0.5" width="319" height="199" rx="14" className="wshot-bg" />
      <path d="M1 14 a13 13 0 0 1 13-13 h292 a13 13 0 0 1 13 13 v12 H1 Z" className="wshot-bar" />
      <circle cx="16" cy="13" r="3.5" className="wshot-dot" />
      <circle cx="28" cy="13" r="3.5" className="wshot-dot" />
      <circle cx="40" cy="13" r="3.5" className="wshot-dot" />
      <rect x="12" y="34" width="52" height="154" rx="10" className="wshot-side" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="22" y={48 + i * 18} width="32" height="8" rx="4" className="wshot-line" />
      ))}
      {kind === 'dash' && (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={76 + i * 80} y="42" width="72" height="40" rx="8" className="wshot-card" />
              <rect x={84 + i * 80} y="52" width="30" height="6" rx="3" className="wshot-line" />
              <rect x={84 + i * 80} y="64" width="44" height="10" rx="4" className="wshot-strong" />
            </g>
          ))}
          <rect x="76" y="92" width="232" height="96" rx="10" className="wshot-card" />
          {bars.map((h, i) => (
            <rect key={i} x={92 + i * 30} y={176 - h} width="16" height={h} rx="4" className="wshot-accent" />
          ))}
        </g>
      )}
      {kind === 'sale' && (
        <g>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={i}>
              <rect x={76 + (i % 3) * 78} y={42 + Math.floor(i / 3) * 56} width="70" height="48" rx="8" className="wshot-card" />
              <rect x={84 + (i % 3) * 78} y={54 + Math.floor(i / 3) * 56} width="40" height="7" rx="3" className="wshot-line" />
              <rect x={84 + (i % 3) * 78} y={68 + Math.floor(i / 3) * 56} width="26" height="9" rx="4" className="wshot-strong" />
            </g>
          ))}
          <rect x="76" y="160" width="160" height="28" rx="8" className="wshot-card" />
          <rect x="244" y="160" width="64" height="28" rx="8" className="wshot-accent" />
        </g>
      )}
      {kind === 'scan' && (
        <g>
          <rect x="96" y="46" width="192" height="104" rx="12" className="wshot-card" />
          <path d="M108 62 v-8 h12 M276 62 v-8 h-12 M108 134 v8 h12 M276 134 v8 h-12" className="wshot-corners" />
          <rect x="112" y="94" width="160" height="4" rx="2" className="wshot-accent" />
          <rect x="128" y="70" width="96" height="6" rx="3" className="wshot-line" />
          <rect x="128" y="112" width="72" height="6" rx="3" className="wshot-line" />
          <rect x="96" y="160" width="120" height="28" rx="8" className="wshot-card" />
          <circle cx="252" cy="174" r="14" className="wshot-badge" />
        </g>
      )}
      {kind === 'stock' && (
        <g>
          <rect x="76" y="42" width="232" height="18" rx="6" className="wshot-bar" />
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <rect x="76" y={66 + i * 25} width="232" height="20" rx="6" className="wshot-card" />
              <rect x="84" y={73 + i * 25} width="70" height="7" rx="3" className="wshot-strong" />
              <rect x="170" y={73 + i * 25} width="40" height="7" rx="3" className="wshot-line" />
              <rect x="228" y={71 + i * 25} width="34" height="10" rx="5" className={i === 2 ? 'wshot-badge' : 'wshot-accent'} />
              <rect x="272" y={73 + i * 25} width="28" height="7" rx="3" className="wshot-line" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

function ThemeMock({ mode }: { mode: WelcomeTheme }) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  const bg = isDark ? '#0f172a' : '#f8fafc';
  const card = isDark ? '#1e293b' : '#ffffff';
  const line = isDark ? '#334155' : '#e2e8f0';
  const accent = '#71717a';
  return (
    <div className="welcome-pick-preview" data-theme-preview={isDark ? 'dark' : 'light'}>
      <svg viewBox="0 0 160 100" className="welcome-mock-svg" aria-hidden>
        <rect width="160" height="100" rx="8" fill={bg} />
        <rect x="8" y="8" width="36" height="84" rx="6" fill={card} stroke={line} strokeWidth="1" />
        <rect x="52" y="8" width="100" height="22" rx="5" fill={card} stroke={line} strokeWidth="1" />
        <rect x="52" y="38" width="100" height="54" rx="5" fill={card} stroke={line} strokeWidth="1" />
        <rect x="62" y="48" width="48" height="8" rx="2" fill={accent} opacity="0.9" />
        <rect x="62" y="62" width="72" height="5" rx="2" fill={line} />
        <rect x="62" y="72" width="56" height="5" rx="2" fill={line} />
      </svg>
    </div>
  );
}


const WELCOME_FEATURES: {
  title: string;
  blurb: string;
  pages: string;
  icon: 'stock' | 'invoice' | 'purchase' | 'clients' | 'balance' | 'hr' | 'mail' | 'agent' | 'security' | 'mobile' | 'reports' | 'morocco';
}[] = [
  {
    title: 'Stock & entrepôt',
    blurb: 'Produits, catégories, mouvements, alertes stock bas, images R2, historique 90 jours.',
    pages: 'Produits · Inventaire · Mouvements',
    icon: 'stock',
  },
  {
    title: 'Ventes FA / VR / Devis',
    blurb: 'Factures, ventes rapides, devis convertibles, paiements partiels, numérotation atomique.',
    pages: 'Factures · Vente rapide · Devis',
    icon: 'invoice',
  },
  {
    title: 'Achats & fournisseurs',
    blurb: 'Factures d’achat, réceptions, fournisseurs, impact stock à la réception.',
    pages: 'Achats · Fournisseurs',
    icon: 'purchase',
  },
  {
    title: 'Clients & crédit',
    blurb: 'Fiches, ICE, soldes, plafonds de crédit, situation client et relances.',
    pages: 'Clients · Situation',
    icon: 'clients',
  },
  {
    title: 'Solde & trésorerie',
    blurb: 'Caisse, banque, dépenses, recettes, salaires — le solde suit chaque mouvement.',
    pages: 'Solde · Dépenses',
    icon: 'balance',
  },
  {
    title: 'Employés & paie',
    blurb: 'Salaire mensuel ou tous les N jours, démission, pièce d’identité chiffrée.',
    pages: 'Employés',
    icon: 'hr',
  },
  {
    title: 'Boîte mail pro',
    blurb: 'Inbox style Gmail, pièces jointes, traduction, anti-spam, archive.',
    pages: 'Mailbox',
    icon: 'mail',
  },
  {
    title: 'Atlas Agent',
    blurb: 'Assistant pour créer clients, produits, documents et interroger le stock.',
    pages: 'Agent (panneau latéral)',
    icon: 'agent',
  },
  {
    title: 'Sécurité',
    blurb: 'Rôles, OTP nouvel appareil, WebAuthn, confirmations, audit, sauvegardes chiffrées.',
    pages: 'Paramètres · Accès',
    icon: 'security',
  },
  {
    title: 'Mobile & caisse',
    blurb: 'Parcours téléphone, vente rapide, tickets et workflows magasin.',
    pages: 'App téléphone · VR',
    icon: 'mobile',
  },
  {
    title: 'Rapports',
    blurb: 'Tableaux de bord, ventes, stock, créances, exports sans tableur parallèle.',
    pages: 'Rapports · Tableau de bord',
    icon: 'reports',
  },
  {
    title: 'Contexte Maroc',
    blurb: 'HT/TTC, TVA, mentions légales, numéros séquentiels, archives longue durée.',
    pages: 'Factures · Paramètres société',
    icon: 'morocco',
  },
];

function FeatureIcon({ name }: { name: (typeof WELCOME_FEATURES)[number]['icon'] }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (name) {
    case 'stock':
      return (
        <svg {...common}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M3.27 6.96 12 12.01l8.73-5.05" />
          <path d="M12 22.08V12" />
        </svg>
      );
    case 'invoice':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V8z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h8M8 17h5" />
        </svg>
      );
    case 'purchase':
      return (
        <svg {...common}>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      );
    case 'clients':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'balance':
      return (
        <svg {...common}>
          <path d="M12 1v22" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case 'hr':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 11h-6M19 8v6" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...common}>
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <path d="m22 6-10 7L2 6" />
        </svg>
      );
    case 'agent':
      return (
        <svg {...common}>
          <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z" />
          <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'security':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'mobile':
      return (
        <svg {...common}>
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="m7 14 4-4 3 3 5-6" />
        </svg>
      );
    case 'morocco':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    default:
      return null;
  }
}

function DensityMock({ density }: { density: WelcomeDensity }) {
  const gap = density === 'comfortable' ? 14 : 6;
  const rowH = density === 'comfortable' ? 16 : 10;
  const rows = density === 'comfortable' ? 3 : 5;
  return (
    <div className="welcome-pick-preview">
      <svg viewBox="0 0 160 100" className="welcome-mock-svg" aria-hidden>
        <rect width="160" height="100" rx="8" fill="#f8fafc" />
        {Array.from({ length: rows }).map((_, i) => (
          <rect
            key={i}
            x="16"
            y={14 + i * (rowH + gap)}
            width="128"
            height={rowH}
            rx="4"
            fill="#71717a"
            opacity={0.25 + i * 0.12}
          />
        ))}
      </svg>
    </div>
  );
}

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
          <text x="156" y="60" textAnchor="middle" fill="#a5b4fc" fontSize="9" fontFamily="monospace" className="welcome-calc-err">
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
              <stop offset="50%" stopColor="#a5b4fc" stopOpacity="1" />
              <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="24" y="48" width="70" height="44" rx="6" fill="#12141a" stroke="#4f46e5" />
          <rect x="32" y="56" width="54" height="8" rx="2" fill="#0b0e14" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <rect key={i} x={34 + i * 5.5} y="68" width={i % 3 === 0 ? 2.5 : 1.5} height="16" fill="#e8f5f0" opacity="0.85" />
          ))}
          <rect x="20" y="62" width="80" height="3" fill="url(#laser)" className="welcome-laser" />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={100 + i * 8} cy={70 - i * 2} r="1.6" fill="#71717a" className="welcome-particle" style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
          <rect x="118" y="28" width="68" height="84" rx="8" fill="#0b0e14" stroke="#71717a" strokeWidth="1.2" />
          <text x="152" y="46" textAnchor="middle" fill="#71717a" fontSize="8" fontWeight="600">
            Ledger
          </text>
          <rect x="128" y="54" width="48" height="5" rx="2" fill="#4f46e5" className="welcome-ledger-bar" />
          <rect x="128" y="64" width="36" height="4" rx="2" fill="#1a1d26" />
          <rect x="128" y="74" width="42" height="4" rx="2" fill="#1a1d26" />
          <text x="152" y="98" textAnchor="middle" fill="#a5b4fc" fontSize="11" fontFamily="monospace" className="welcome-ledger-sum">
            1 240 DH
          </text>
        </svg>
        <p className="welcome-compare-caption">Scan laser, sync instantanée, solde auto.</p>
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
          {Array.from({ length: 8 }).map((_, r) =>
            Array.from({ length: 12 }).map((_, c) => (
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
        <span className="welcome-compare-badge good">Tableau de bord Atlas</span>
        <svg viewBox="0 0 200 140" className="welcome-scene-svg" aria-hidden>
          <rect x="12" y="12" width="176" height="116" rx="10" fill="#0b0e14" />
          <rect x="22" y="22" width="48" height="18" rx="9" fill="#12141a" stroke="#4f46e5" className="welcome-pill" />
          <rect x="76" y="22" width="48" height="18" rx="9" fill="#12141a" stroke="#4f46e5" className="welcome-pill" style={{ animationDelay: '0.15s' }} />
          <rect x="130" y="22" width="48" height="18" rx="9" fill="#12141a" stroke="#4f46e5" className="welcome-pill" style={{ animationDelay: '0.3s' }} />
          <path
            d="M28 100 C48 90, 58 70, 78 75 S108 110, 128 85 S158 60, 178 55"
            fill="none"
            stroke="#71717a"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="welcome-chart-path"
          />
          <circle cx="178" cy="55" r="3.5" fill="#a5b4fc" className="welcome-chart-dot" />
          <rect x="22" y="112" width="70" height="6" rx="2" fill="#1a1d26" className="welcome-feed" />
          <rect x="98" y="112" width="50" height="6" rx="2" fill="#4f46e5" className="welcome-feed" style={{ animationDelay: '0.2s' }} />
        </svg>
        <p className="welcome-compare-caption">Vue claire, flux en direct, zéro friction.</p>
      </div>
    </div>
  );
}

function MasteryTips() {
  const tips = [
    {
      title: 'Workflow code-barres',
      body: 'PC : scan USB. Mobile : caméra ou photo de secours si le cadre rate le code.',
      svg: (
        <svg viewBox="0 0 64 40" className="welcome-tip-svg" aria-hidden>
          <rect x="4" y="8" width="28" height="24" rx="3" fill="#12141a" stroke="#4f46e5" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={8 + i * 4.5} y="14" width={i % 2 ? 2 : 1.2} height="12" fill="#e8f5f0" />
          ))}
          <rect x="36" y="10" width="24" height="20" rx="4" fill="#0b0e14" stroke="#71717a" />
          <circle cx="48" cy="20" r="6" fill="none" stroke="#71717a" strokeWidth="1.5" className="welcome-cam-pulse" />
        </svg>
      ),
    },
    {
      title: 'Récupération intelligente',
      body: "Scan impossible ? Image de l'étiquette ou saisie manuelle — le PC reçoit quand même la proposition.",
      svg: (
        <svg viewBox="0 0 64 40" className="welcome-tip-svg" aria-hidden>
          <rect x="10" y="6" width="32" height="28" rx="3" fill="#12141a" stroke="#4f46e5" />
          <path d="M18 26 L24 20 L30 24 L36 16" fill="none" stroke="#71717a" strokeWidth="1.5" className="welcome-path-draw" />
          <circle cx="48" cy="28" r="8" fill="#0a0a0a" opacity="0.9" />
          <path d="M45 28 L47.5 30.5 L52 25" fill="none" stroke="#e8f5f0" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: 'Intégrité du stock',
      body: "Le téléphone propose ; le bureau valide. L'historique produit montre avant / après en direct.",
      svg: (
        <svg viewBox="0 0 64 40" className="welcome-tip-svg" aria-hidden>
          <rect x="6" y="8" width="24" height="24" rx="4" fill="#0b0e14" stroke="#4f46e5" />
          <text x="18" y="24" textAnchor="middle" fill="#94a3b8" fontSize="8">
            12
          </text>
          <path d="M34 20 H42" stroke="#71717a" strokeWidth="1.5" className="welcome-sync-arrow" />
          <rect x="44" y="8" width="14" height="24" rx="3" fill="#12141a" stroke="#71717a" />
          <text x="51" y="24" textAnchor="middle" fill="#a5b4fc" fontSize="8" className="welcome-stock-live">
            15
          </text>
        </svg>
      ),
    },
  ];
  return (
    <div className="welcome-mastery">
      <h3 className="welcome-mastery-title">Prise en main rapide</h3>
      <div className="welcome-mastery-grid">
        {tips.map((t, i) => (
          <article key={t.title} className="welcome-mastery-card" style={{ animationDelay: `${0.08 + i * 0.08}s` }}>
            {t.svg}
            <h4>{t.title}</h4>
            <p>{t.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function WelcomeTourGate({ show, onClose, steps }: { show: boolean; onClose: () => void; steps: any[] }) {
  if (!show) return null;
  return <FeatureTour steps={steps} onClose={onClose} />;
}

export default function Welcome() {
  const navigate = useNavigate();
  const [showTour, setShowTour] = useState(false);
  const tourSteps = useMemo(
    () => [
      {
        id: 'stock',
        title: 'Stock & produits',
        description: 'Catalogue, seuils bas, scan code-barres et mouvements d’entrepôt.',
        icon: <Package size={40} strokeWidth={1.5} />,
      },
      {
        id: 'sales',
        title: 'Ventes & factures',
        description: 'Devis, FA, VR, reçus et TVA — numérotation centralisée.',
        icon: <FileText size={40} strokeWidth={1.5} />,
      },
      {
        id: 'people',
        title: 'Clients & équipe',
        description: 'Fiches clients, employés, présence et acomptes.',
        icon: <Users size={40} strokeWidth={1.5} />,
      },
      {
        id: 'agent',
        title: 'Atlas Agent',
        description: 'Assistant connecté aux API : créer, chercher, expliquer.',
        icon: <Bot size={40} strokeWidth={1.5} />,
      },
      {
        id: 'reports',
        title: 'Pilotage',
        description: 'Tableau de bord, rapports et clôture de période.',
        icon: <BarChart3 size={40} strokeWidth={1.5} />,
      },
    ],
    [],
  );

  const [step, setStep] = useState(() => getWelcomeStep());
  const [prefs, setPrefs] = useState<WelcomePrefs>(() => getWelcomePrefs());
  const [showNext, setShowNext] = useState(step !== 0);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [compareTab, setCompareTab] = useState<'paper' | 'erp'>('paper');

  useEffect(() => {
    if (isWelcomeCompleted()) navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    setWelcomeStep(step);
  }, [step]);

  useEffect(() => {
    applyThemeMode(prefs.theme);
    setDensity('comfortable');
    setGlassEnabled(false);
  }, [prefs]);

  useEffect(() => {
    if (step !== 0) {
      setShowNext(true);
      return;
    }
    setShowNext(false);
    const t = window.setTimeout(() => setShowNext(true), 1200);
    return () => window.clearTimeout(t);
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/users/${APP_CREATOR}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
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
      if (e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'radio' && (t as HTMLInputElement).type !== 'button'))) {
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
  }, [step, showNext, leaving, go]);

  const pickTheme = (theme: WelcomeTheme) => {
    setPrefs(saveWelcomePrefs({ theme }));
    applyThemeMode(theme);
  };

  const pickDensity = (density: WelcomeDensity) => {
    setPrefs(saveWelcomePrefs({ density }));
    setDensity(density);
  };


  const finish = () => {
    setLeaving(true);
    applyThemeMode(prefs.theme);
    setDensity('comfortable');
    setGlassEnabled(false);
    markWelcomeCompleted();
    setShowTour(true);
    window.setTimeout(() => {
      navigate('/', { replace: true });
      try {
        window.location.reload();
      } catch {
        /* */
      }
    }, 480);
  };

  const progress = useMemo(() => ((step + 1) / WELCOME_STEP_COUNT) * 100, [step]);

  return (
    <div className={`welcome-stage${leaving ? ' welcome-leaving' : ''}`} data-step={step}>
      {showTour ? <FeatureTour steps={tourSteps} onClose={() => { setShowTour(false); navigate('/'); }} /> : null}

      <div className="welcome-ambient" aria-hidden />
      <div
        className="welcome-progress"
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={WELCOME_STEP_COUNT}
      >
        <div className="welcome-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="welcome-inner">
        {step === 0 && (
          <section className="welcome-panel welcome-hello" key="hello">
            <p className="welcome-kicker">{APP_NAME}</p>
            <h1 className="welcome-bonjour">
              {'Bonjour'.split('').map((ch, i) => (
                <span key={i} style={{ animationDelay: `${0.08 + i * 0.06}s` }}>
                  {ch}
                </span>
              ))}
            </h1>
            <p className="welcome-sub welcome-fade-late">
              Configurons votre espace — thème, style, et ce qui change vraiment face au papier et aux outils lourds.
            </p>
            {showNext && (
              <button type="button" className="welcome-cta welcome-cta-glow" onClick={() => go(1)}>
                Suivant
              </button>
            )}
          </section>
        )}

        {step === 1 && (
          <section className="welcome-panel" key="theme">
            <h2 className="welcome-title">Choisissez votre thème</h2>
            <p className="welcome-sub">Aperçu en direct sur l&apos;interface.</p>
            <div className="welcome-picks welcome-picks-3">
              {(
                [
                  { id: 'dark' as const, label: 'Sombre' },
                  { id: 'light' as const, label: 'Clair' },
                  { id: 'system' as const, label: 'Système' },
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
                  <span className="welcome-pick-label">{opt.label}</span>
                </button>
              ))}
            </div>
            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(0)}>
                Retour
              </button>
              <button type="button" className="welcome-cta" onClick={() => go(2)}>
                Suivant
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
                    <section className="welcome-panel welcome-panel-wide" key="features">
            <div className="welcome-features-hero">
              <span className="welcome-features-badge">★ Nos fonctionnalités</span>
              <h2 className="welcome-title">Tout pour vendre et gérer plus vite</h2>
              <p className="welcome-sub">Du stock à la facture, de la caisse aux employés — un seul outil clair.</p>
              <div className="welcome-hero-shot">
                <img
                  src="/app-screenshot.svg"
                  alt="Aperçu Atlas Commerce — tableau de bord"
                  width={960}
                  height={504}
                  loading="eager"
                  decoding="async"
                />
              </div>
            </div>
            <div className="welcome-features-grid">
              {WELCOME_FEATURES.map((f, i) => (
                <article
                  key={f.title}
                  className="welcome-feature-card"
                  style={{ animationDelay: `${0.04 + i * 0.03}s` }}
                >
                  <div className="welcome-feature-icon" aria-hidden>
                    <FeatureIcon name={f.icon} />
                  </div>
                  <div className="welcome-feature-body">
                    <strong>{f.title}</strong>
                    <span className="welcome-feature-blurb">{f.blurb}</span>
                    <span className="welcome-feature-pages">{f.pages}</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="wshots" aria-label="Aperçu des écrans">
              {(
                [
                  ['dash', 'Tableau de bord'],
                  ['sale', 'Caisse rapide'],
                  ['scan', 'Scan & réassort'],
                  ['stock', 'Catalogue & stock'],
                ] as const
              ).map(([k, cap]) => (
                <div className="wshot-frame" key={k}>
                  <ScreenShot kind={k} />
                  <div className="wshot-cap">{cap}</div>
                </div>
              ))}
            </div>
            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(1)}>
                Retour
              </button>
              <button type="button" className="welcome-cta" onClick={() => go(3)}>
                Suivant
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="welcome-panel welcome-panel-wide" key="compare">
            <h2 className="welcome-title">Pourquoi {APP_NAME} change la donne</h2>
            <p className="welcome-sub">Comparaisons animées — papier &amp; outils lourds face à Atlas.</p>
            <div className="welcome-segment" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={compareTab === 'paper'}
                className={compareTab === 'paper' ? 'active' : ''}
                onClick={() => setCompareTab('paper')}
              >
                Papier vs Atlas
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={compareTab === 'erp'}
                className={compareTab === 'erp' ? 'active' : ''}
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
              <button type="button" className="welcome-btn-ghost" onClick={() => go(2)}>
                Retour
              </button>
              <button type="button" className="welcome-cta" onClick={() => go(4)}>
                Suivant
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="welcome-panel welcome-close" key="close">
            <p className="welcome-thanks welcome-fade-up">Merci de nous faire confiance</p>
            <h2 className="welcome-title welcome-fade-up" style={{ animationDelay: '0.08s' }}>
              Bienvenue dans {APP_NAME}
            </h2>
            <p className="welcome-sub welcome-fade-up" style={{ animationDelay: '0.14s', marginLeft: 'auto', marginRight: 'auto' }}>
              Merci d&apos;avoir choisi Atlas — stock, factures et caisse, sans abonnement et sous votre contrôle.
            </p>

            <div className="welcome-creator-badge welcome-fade-up" style={{ animationDelay: '0.2s' }}>
              {avatar ? (
                <img src={avatar} alt="" className="welcome-avatar" width={72} height={72} />
              ) : (
                <div className="welcome-avatar welcome-avatar-fallback">{APP_CREATOR_NAME.slice(0, 1)}</div>
              )}
              <div>
                <p className="welcome-kicker">Créateur</p>
                <h2 className="welcome-title" style={{ margin: 0, fontSize: '1.25rem' }}>
                  {APP_CREATOR_NAME}
                </h2>
                <a href={APP_GITHUB} target="_blank" rel="noreferrer" className="welcome-gh-link">
                  @{APP_CREATOR} · GitHub
                </a>
              </div>
            </div>
            <p className="welcome-craft welcome-fade-up" style={{ animationDelay: '0.26s' }}>
              Conçu avec passion pour simplifier la gestion commerciale — sans compromis.
            </p>

            <div className="welcome-projects welcome-fade-up" style={{ animationDelay: '0.32s' }}>
              <p className="welcome-projects-title">Autres projets</p>
              <div className="welcome-projects-grid">
                <a className="welcome-project-card" href="https://chat.afmarbre.com" target="_blank" rel="noreferrer">
                  <strong>Paul</strong>
                  <span>Agent IA privé sur Cloudflare</span>
                </a>
                <a className="welcome-project-card" href="https://support.afmarbre.com" target="_blank" rel="noreferrer">
                  <strong>Support</strong>
                  <span>Page support clients</span>
                </a>
                <a className="welcome-project-card" href="https://github.com/loxdpsy/archi-convert" target="_blank" rel="noreferrer">
                  <strong>Archi Convert</strong>
                  <span>Unités &amp; matériaux</span>
                </a>
                <a className="welcome-project-card" href="https://github.com/loxdpsy/toolkit" target="_blank" rel="noreferrer">
                  <strong>Toolkit</strong>
                  <span>Boîte à outils TypeScript</span>
                </a>
              </div>
            </div>

            <div className="welcome-nav">
              <button type="button" className="welcome-btn-ghost" onClick={() => go(3)}>
                Retour
              </button>
              <button type="button" className="welcome-cta welcome-cta-glow" onClick={finish} disabled={leaving}>
                {leaving ? 'Ouverture…' : 'Explorer Atlas Commerce'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
