import { Link, useLocation, useParams } from 'react-router-dom';
import { isLoggedIn, getToken, getRole, isStockRole } from '../auth';

/** HTTP-style error kinds (nginx-error-pages inspired) */
export type AccessKind =
  | 'not-found'
  | 'forbidden'
  | 'login-required'
  | 'bad-request'
  | 'unauthorized'
  | 'payment-required'
  | 'method-not-allowed'
  | 'timeout'
  | 'conflict'
  | 'gone'
  | 'teapot'
  | 'too-many'
  | 'server'
  | 'bad-gateway'
  | 'unavailable'
  | 'crash';

const COPY: Record<AccessKind, { subtitle: string; title: string; body: string; code: string }> = {
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
  unauthorized: {
    subtitle: 'Erreur 401',
    title: 'Non autorisé',
    body: 'Votre session a expiré ou les identifiants sont invalides. Reconnectez-vous.',
    code: '401',
  },
  'bad-request': {
    subtitle: 'Erreur 400',
    title: 'Requête invalide',
    body: 'La demande envoyée au serveur est incorrecte ou incomplète.',
    code: '400',
  },
  'payment-required': {
    subtitle: 'Erreur 402',
    title: 'Paiement requis',
    body: 'Cette action nécessite un règlement ou une autorisation de paiement.',
    code: '402',
  },
  'method-not-allowed': {
    subtitle: 'Erreur 405',
    title: 'Méthode non autorisée',
    body: 'Cette opération HTTP n’est pas permise sur cette ressource.',
    code: '405',
  },
  timeout: {
    subtitle: 'Erreur 408',
    title: 'Délai dépassé',
    body: 'Le serveur a attendu trop longtemps. Vérifiez votre connexion et réessayez.',
    code: '408',
  },
  conflict: {
    subtitle: 'Erreur 409',
    title: 'Conflit',
    body: 'La ressource a été modifiée ailleurs. Rechargez puis recommencez.',
    code: '409',
  },
  gone: {
    subtitle: 'Erreur 410',
    title: 'Ressource supprimée',
    body: 'Cette ressource n’existe plus de façon permanente.',
    code: '410',
  },
  teapot: {
    subtitle: 'Erreur 418',
    title: 'Je suis une théière',
    body: 'Erreur humoristique : le serveur refuse de préparer du café (RFC 2324).',
    code: '418',
  },
  'too-many': {
    subtitle: 'Erreur 429',
    title: 'Trop de requêtes',
    body: 'Vous avez envoyé trop de demandes. Patientez un instant puis réessayez.',
    code: '429',
  },
  server: {
    subtitle: 'Erreur 500',
    title: 'Erreur serveur',
    body: 'Une erreur interne s’est produite. Réessayez ; si cela continue, contactez le support.',
    code: '500',
  },
  'bad-gateway': {
    subtitle: 'Erreur 502',
    title: 'Passerelle invalide',
    body: 'Le serveur amont a renvoyé une réponse invalide. Réessayez dans un moment.',
    code: '502',
  },
  unavailable: {
    subtitle: 'Erreur 503',
    title: 'Service indisponible',
    body: 'Le service est temporairement indisponible (maintenance ou surcharge).',
    code: '503',
  },
  crash: {
    subtitle: 'Erreur application',
    title: 'Une erreur est survenue',
    body: "L'écran a planté. Vos données sur le serveur ne sont pas perdues. Réessayez ou rechargez la page.",
    code: 'ERR',
  },
};

const CODE_TO_KIND: Record<string, AccessKind> = {
  '400': 'bad-request',
  '401': 'unauthorized',
  '402': 'payment-required',
  '403': 'forbidden',
  '404': 'not-found',
  '405': 'method-not-allowed',
  '408': 'timeout',
  '409': 'conflict',
  '410': 'gone',
  '418': 'teapot',
  '429': 'too-many',
  '500': 'server',
  '502': 'bad-gateway',
  '503': 'unavailable',
};

/** Soft floating ghost — Atlas teal */
export function AtlasGhost({ label }: { label: string }) {
  return (
    <div className="access-ghost" aria-hidden>
      <svg className="access-ghost-svg" viewBox="0 0 200 220" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse className="access-ghost-shadow" cx="100" cy="205" rx="48" ry="8" fill="currentColor" opacity="0.12" />
        <path
          className="access-ghost-body"
          d="M100 18c-36 0-62 28-62 70v78c0 6 4 10 10 10 8 0 12-8 20-8s12 8 20 8 12-8 20-8 12 8 20 8 12-8 20-8c6 0 10-4 10-10V88c0-42-26-70-62-70z"
          fill="currentColor"
        />
        <circle cx="78" cy="88" r="10" fill="var(--access-ghost-eye, #0a0e1a)" />
        <circle cx="122" cy="88" r="10" fill="var(--access-ghost-eye, #0a0e1a)" />
        <circle cx="81" cy="85" r="3.5" fill="#fff" opacity="0.9" />
        <circle cx="125" cy="85" r="3.5" fill="#fff" opacity="0.9" />
        <path
          d="M82 118c8 12 28 12 36 0"
          stroke="var(--access-ghost-eye, #0a0e1a)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="access-ghost-badge">{label}</span>
    </div>
  );
}

export default function AccessPage({
  kind = 'not-found',
  detail,
  code,
  onRetry,
  onReload,
  onHome,
}: {
  kind?: AccessKind;
  detail?: string;
  code?: string;
  onRetry?: () => void;
  onReload?: () => void;
  onHome?: () => void;
}) {
  const loc = useLocation();
  const logged = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  const home = !logged ? '/login' : isStockRole() ? '/products' : '/';
  const c = COPY[kind] || COPY['not-found'];
  const displayCode = code || c.code;

  return (
    <div className={`access-page access-page--${kind} access-page--fullscreen`}>
      <div className="access-home container">
        <div className="access-home__data">
          <span className="access-home__subtitle">{code ? `Erreur ${displayCode}` : c.subtitle}</span>
          <h1 className="access-home__title">{c.title}</h1>
          <p className="access-home__description">{c.body}</p>
          {kind === 'forbidden' && logged && (
            <p className="access-meta">
              Rôle actuel : <strong>{getRole() || '—'}</strong>
            </p>
          )}
          {(kind === 'not-found' || kind === 'crash') && (
            <p className="access-meta access-path">
              <code>
                {(loc.state as { attempted?: string } | null)?.attempted ||
                  detail ||
                  loc.pathname}
              </code>
            </p>
          )}
          {kind === 'crash' && (
            <p className="access-meta">
              Code : <strong>{displayCode}</strong>
              {/\b(40[0-9]|41[0-9]|42[0-9]|43[0-9]|44[0-9]|45[0-9]|50[0-9]|51[0-9])\b/.test(displayCode)
                ? ' (HTTP)'
                : ' (client)'}
            </p>
          )}
          {detail && kind === 'crash' && (
            <pre className="access-error-detail">{detail}</pre>
          )}
          <div className="access-actions">
            {onRetry && (
              <button type="button" className="access-home__button" onClick={onRetry}>
                Réessayer
              </button>
            )}
            {onReload && (
              <button type="button" className="access-home__button access-home__button--ghost" onClick={onReload}>
                Recharger
              </button>
            )}
            {onHome ? (
              <button type="button" className="access-home__button access-home__button--ghost" onClick={onHome}>
                {logged ? 'Retour à l’accueil' : 'Se connecter'}
              </button>
            ) : (
              <Link to={home} className="access-home__button access-home__button--ghost">
                {logged ? 'Retour à l’accueil' : 'Se connecter'}
              </Link>
            )}
            {logged && kind === 'forbidden' && (
              <Link to="/products" className="access-home__button access-home__button--ghost">
                Produits
              </Link>
            )}
          </div>
        </div>
        <div className="access-home__visual">
          <AtlasGhost label={displayCode} />
        </div>
      </div>
    </div>
  );
}

/** Route /error/:code — e.g. /error/502 */
export function HttpErrorPage() {
  const { code } = useParams();
  const kind = CODE_TO_KIND[String(code || '500')] || 'server';
  return <AccessPage kind={kind} />;
}

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
