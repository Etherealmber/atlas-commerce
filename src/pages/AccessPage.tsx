import { Link, useLocation } from 'react-router-dom';
import { isLoggedIn, getToken, getRole, isStockRole } from '../auth';

export type AccessKind = 'not-found' | 'forbidden' | 'login-required';

const COPY: Record<
  AccessKind,
  { subtitle: string; title: string; body: string; code: string }
> = {
  'not-found': {
    subtitle: 'Erreur 404',
    title: 'Page introuvable',
    body: "Nous n'arrivons pas à trouver la page que vous cherchez. Elle a peut‑être été déplacée ou n'existe pas.",
    code: '404',
  },
  forbidden: {
    subtitle: 'Erreur 403',
    title: 'Accès refusé',
    body: "Votre rôle ne permet pas d'ouvrir cette page. Contactez un administrateur si vous avez besoin de plus de droits.",
    code: '403',
  },
  'login-required': {
    subtitle: 'Connexion',
    title: 'Connexion requise',
    body: 'Cette page est réservée aux utilisateurs connectés. Connectez-vous pour continuer.',
    code: '401',
  },
};

/** Soft floating ghost — Atlas teal, no external assets */
function AtlasGhost({ label }: { label: string }) {
  return (
    <div className="access-ghost" aria-hidden>
      <svg className="access-ghost-svg" viewBox="0 0 200 220" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse className="access-ghost-shadow" cx="100" cy="205" rx="48" ry="8" fill="currentColor" opacity="0.12" />
        <path
          className="access-ghost-body"
          d="M100 18c-36 0-62 28-62 70v78c0 6 4 10 10 10 8 0 12-8 20-8s12 8 20 8 12-8 20-8 12 8 20 8 12-8 20-8c6 0 10-4 10-10V88c0-42-26-70-62-70z"
          fill="currentColor"
        />
        <circle cx="78" cy="88" r="10" fill="var(--access-ghost-eye, #0a3d3a)" />
        <circle cx="122" cy="88" r="10" fill="var(--access-ghost-eye, #0a3d3a)" />
        <circle cx="81" cy="85" r="3.5" fill="#fff" opacity="0.9" />
        <circle cx="125" cy="85" r="3.5" fill="#fff" opacity="0.9" />
        <path
          d="M82 118c8 12 28 12 36 0"
          stroke="var(--access-ghost-eye, #0a3d3a)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="access-ghost-badge">{label}</span>
    </div>
  );
}

export default function AccessPage({ kind = 'not-found' }: { kind?: AccessKind }) {
  const loc = useLocation();
  const logged = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  const home = !logged ? '/login' : isStockRole() ? '/products' : '/';
  const c = COPY[kind];

  return (
    <div className={`access-page access-page--${kind}`}>
      <div className="access-home container">
        <div className="access-home__data">
          <span className="access-home__subtitle">{c.subtitle}</span>
          <h1 className="access-home__title">{c.title}</h1>
          <p className="access-home__description">{c.body}</p>
          {kind === 'forbidden' && logged && (
            <p className="access-meta">
              Rôle actuel : <strong>{getRole() || '—'}</strong>
            </p>
          )}
          {kind === 'not-found' && (
            <p className="access-meta access-path">
              <code>{(loc.state as { attempted?: string } | null)?.attempted || loc.pathname}</code>
            </p>
          )}
          <div className="access-actions">
            <Link to={home} className="access-home__button">
              {logged ? 'Retour à l’accueil' : 'Se connecter'}
            </Link>
            {logged && kind === 'forbidden' && (
              <Link to="/products" className="access-home__button access-home__button--ghost">
                Produits
              </Link>
            )}
            {logged && (
              <Link to="/settings" className="access-home__button access-home__button--ghost">
                Paramètres
              </Link>
            )}
          </div>
        </div>

        <div className="access-home__visual">
          <AtlasGhost label={c.code} />
        </div>
      </div>
    </div>
  );
}

/** Gate by role — shows 403 page instead of silent redirect */
export function RoleGate({
  allow,
  children,
}: {
  allow: boolean;
  children: React.ReactNode;
}) {
  if (!allow) return <AccessPage kind="forbidden" />;
  return <>{children}</>;
}
