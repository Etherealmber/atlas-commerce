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

/** Custom glass toggle — no native checkbox */
function GlassToggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`welcome-switch-card${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <div className="welcome-switch-copy">
        <span className="welcome-switch-label">{label}</span>
        {hint ? <span className="welcome-switch-hint">{hint}</span> : null}
      </div>
      <span className="welcome-switch-track" aria-hidden>
        <span className="welcome-switch-thumb" />
      </span>
    </button>
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
  const accent = '#10b981';
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
            fill="#10b981"
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
          <rect x="134" y="48" width="44" height="16" rx="2" fill="#1a3a2a" />
          <text x="156" y="60" textAnchor="middle" fill="#7dff9a" fontSize="9" fontFamily="monospace" className="welcome-calc-err">
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
              <stop offset="0%" stopColor="#55c4a5" stopOpacity="0" />
              <stop offset="50%" stopColor="#7dffc8" stopOpacity="1" />
              <stop offset="100%" stopColor="#55c4a5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="24" y="48" width="70" height="44" rx="6" fill="#14352c" stroke="#2d8a72" />
          <rect x="32" y="56" width="54" height="8" rx="2" fill="#0B1F1A" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <rect key={i} x={34 + i * 5.5} y="68" width={i % 3 === 0 ? 2.5 : 1.5} height="16" fill="#e8f5f0" opacity="0.85" />
          ))}
          <rect x="20" y="62" width="80" height="3" fill="url(#laser)" className="welcome-laser" />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={100 + i * 8} cy={70 - i * 2} r="1.6" fill="#55c4a5" className="welcome-particle" style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
          <rect x="118" y="28" width="68" height="84" rx="8" fill="#0B1F1A" stroke="#55c4a5" strokeWidth="1.2" />
          <text x="152" y="46" textAnchor="middle" fill="#55c4a5" fontSize="8" fontWeight="600">
            Ledger
          </text>
          <rect x="128" y="54" width="48" height="5" rx="2" fill="#2d8a72" className="welcome-ledger-bar" />
          <rect x="128" y="64" width="36" height="4" rx="2" fill="#1e4a3c" />
          <rect x="128" y="74" width="42" height="4" rx="2" fill="#1e4a3c" />
          <text x="152" y="98" textAnchor="middle" fill="#7dffc8" fontSize="11" fontFamily="monospace" className="welcome-ledger-sum">
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
            <rect key={`h${i}`} x={14 + i * 15} y="16" width="14" height="10" fill="#2d4a2d" opacity="0.8" />
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
          <rect x="12" y="12" width="176" height="116" rx="10" fill="#0B1F1A" />
          <rect x="22" y="22" width="48" height="18" rx="9" fill="#14352c" stroke="#2d8a72" className="welcome-pill" />
          <rect x="76" y="22" width="48" height="18" rx="9" fill="#14352c" stroke="#2d8a72" className="welcome-pill" style={{ animationDelay: '0.15s' }} />
          <rect x="130" y="22" width="48" height="18" rx="9" fill="#14352c" stroke="#2d8a72" className="welcome-pill" style={{ animationDelay: '0.3s' }} />
          <path
            d="M28 100 C48 90, 58 70, 78 75 S108 110, 128 85 S158 60, 178 55"
            fill="none"
            stroke="#55c4a5"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="welcome-chart-path"
          />
          <circle cx="178" cy="55" r="3.5" fill="#7dffc8" className="welcome-chart-dot" />
          <rect x="22" y="112" width="70" height="6" rx="2" fill="#1e4a3c" className="welcome-feed" />
          <rect x="98" y="112" width="50" height="6" rx="2" fill="#2d8a72" className="welcome-feed" style={{ animationDelay: '0.2s' }} />
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
          <rect x="4" y="8" width="28" height="24" rx="3" fill="#14352c" stroke="#2d8a72" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={8 + i * 4.5} y="14" width={i % 2 ? 2 : 1.2} height="12" fill="#e8f5f0" />
          ))}
          <rect x="36" y="10" width="24" height="20" rx="4" fill="#0B1F1A" stroke="#55c4a5" />
          <circle cx="48" cy="20" r="6" fill="none" stroke="#55c4a5" strokeWidth="1.5" className="welcome-cam-pulse" />
        </svg>
      ),
    },
    {
      title: 'Récupération intelligente',
      body: "Scan impossible ? Image de l'étiquette ou saisie manuelle — le PC reçoit quand même la proposition.",
      svg: (
        <svg viewBox="0 0 64 40" className="welcome-tip-svg" aria-hidden>
          <rect x="10" y="6" width="32" height="28" rx="3" fill="#14352c" stroke="#2d8a72" />
          <path d="M18 26 L24 20 L30 24 L36 16" fill="none" stroke="#55c4a5" strokeWidth="1.5" className="welcome-path-draw" />
          <circle cx="48" cy="28" r="8" fill="#1a6b66" opacity="0.9" />
          <path d="M45 28 L47.5 30.5 L52 25" fill="none" stroke="#e8f5f0" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: 'Intégrité du stock',
      body: "Le téléphone propose ; le bureau valide. L'historique produit montre avant / après en direct.",
      svg: (
        <svg viewBox="0 0 64 40" className="welcome-tip-svg" aria-hidden>
          <rect x="6" y="8" width="24" height="24" rx="4" fill="#0B1F1A" stroke="#2d8a72" />
          <text x="18" y="24" textAnchor="middle" fill="#9cb0a8" fontSize="8">
            12
          </text>
          <path d="M34 20 H42" stroke="#55c4a5" strokeWidth="1.5" className="welcome-sync-arrow" />
          <rect x="44" y="8" width="14" height="24" rx="3" fill="#14352c" stroke="#55c4a5" />
          <text x="51" y="24" textAnchor="middle" fill="#7dffc8" fontSize="8" className="welcome-stock-live">
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

export default function Welcome() {
  const navigate = useNavigate();
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
    setDensity(prefs.density);
    setGlassEnabled(prefs.liquidGlass);
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

  const pickTheme = (theme: WelcomeTheme) => {
    setPrefs(saveWelcomePrefs({ theme }));
    applyThemeMode(theme);
  };

  const pickDensity = (density: WelcomeDensity) => {
    setPrefs(saveWelcomePrefs({ density }));
    setDensity(density);
  };

  const toggleGlass = (on: boolean) => {
    setPrefs(saveWelcomePrefs({ liquidGlass: on }));
    setGlassEnabled(on);
  };

  const finish = () => {
    setLeaving(true);
    applyThemeMode(prefs.theme);
    setDensity(prefs.density);
    setGlassEnabled(prefs.liquidGlass);
    markWelcomeCompleted();
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
              Configurons votre espace — thème, densité, et ce qui change vraiment face au papier et aux outils lourds.
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
          <section className="welcome-panel" key="density">
            <h2 className="welcome-title">Mode d&apos;affichage</h2>
            <p className="welcome-sub">Confort lisible ou densité pour les flux rapides.</p>
            <div className="welcome-picks welcome-picks-2">
              <button
                type="button"
                className={`welcome-pick${prefs.density === 'comfortable' ? ' is-selected' : ''}`}
                onClick={() => pickDensity('comfortable')}
                style={{ animationDelay: '0.05s' }}
              >
                <DensityMock density="comfortable" />
                <span className="welcome-pick-label">Mode Confort</span>
                <span className="welcome-pick-hint">Espacements généreux, lecture détendue</span>
              </button>
              <button
                type="button"
                className={`welcome-pick${prefs.density === 'compact' ? ' is-selected' : ''}`}
                onClick={() => pickDensity('compact')}
                style={{ animationDelay: '0.12s' }}
              >
                <DensityMock density="compact" />
                <span className="welcome-pick-label">Mode Compact</span>
                <span className="welcome-pick-hint">Grille dense, workflows accélérés</span>
              </button>
            </div>
            {prefs.density === 'comfortable' && (
              <GlassToggle
                on={prefs.liquidGlass}
                onChange={toggleGlass}
                label="Activer l'effet Liquid Glass"
                hint="Flou, transparence et accents givrés sur l'interface"
              />
            )}
            {prefs.density === 'compact' && (
              <p className="welcome-note">
                Le mode compact désactive automatiquement Liquid Glass pour maximiser la densité des données.
              </p>
            )}
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
