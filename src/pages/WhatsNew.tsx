import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Wrench, AlertCircle, ArrowUpCircle } from 'lucide-react';
import { APP_VERSION, APP_BUILD_DATE } from '../version';
import { markWhatsNewSeen } from '../lib/whatsNew';

type SectionKind = 'features' | 'improvements' | 'fixes' | 'breaking';

type Section = {
  kind: SectionKind;
  items: { id: string; text: string }[];
};

type Release = {
  version: string;
  date: string;
  sections: Section[];
};


const RELEASES: Release[] = [
  {
    version: '0.4.9-beta',
    date: '22 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '049a1', text: 'E-mails OTP via Resend (déjà configuré) : le code part vers la boîte de l’utilisateur (app_users.email), repli sur le binding Cloudflare — fini le « E-mail indisponible » en production' },
          { id: '049a2', text: 'Nouveau gabarit d’e-mail OTP : en-tête charbon + monogramme cuivre, code espacé lisible, bloc appareil/IP, lien de vérification, avertissement de sécurité' },
          { id: '049a3', text: 'Atlas Agent lit réellement les images jointes (vision Groq : qwen3.8-27b / llama-4-scout) — logos, factures et captures sont analysés, miniatures dans la bulle' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '049b1', text: 'Envoi de l’e-mail de connexion en arrière-plan (waitUntil) et course 2,5 s sur les OTP de suppression : l’interface ne bloque plus jamais sur un fournisseur lent' },
          { id: '049b2', text: 'Mémoire compacte de l’agent (6 derniers tours, ~250 jetons) + facturation des jetons réels côté serveur (prompt+completion) au lieu d’une estimation client' },
          { id: '049b3', text: 'Numérotation revue : la vraie release sera 1.0.0 — le cycle bêta courant passe en 0.4.9, historique repris depuis la 0.0.1' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '049c1', text: 'SÉCURITÉ : en production, les codes OTP ne sont plus jamais renvoyés dans les réponses API (otp vide + message propre) — le second facteur reste exclusivement postal' },
          { id: '049c2', text: 'Boutons ✎ / ✕ des pièces jointes visibles dans les deux thèmes (SVG inline + exclus des chaînes CSS globales) ; titres d’images masqués partout' },
          { id: '049c3', text: 'Note OTP (Confirmer / Annuler / champ) en palette zinc claire et sombre — plus de boutons noirs ni de fond crème' },
          { id: '049c4', text: 'Pare-feu applicatif (WAF) sur /api/* : signatures SQLi, traversal, XSS et log4j bloquées (403) ; endpoint /api/canary pour la santé des déploiements' },
        ],
      },
    ],
  },
  {
    version: '0.4.8-beta',
    date: '21 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '048a1', text: 'Heure exacte de rafraîchissement du quota affichée partout (messages, bannière, Paramètres) : minuit UTC chaque jour, lundi 00:00 UTC chaque semaine' },
          { id: '048a2', text: 'Journal D1 de toute consommation de jetons (agent_usage_log) — survit aux remises à zéro, consultable par le propriétaire' },
          { id: '048a3', text: 'Migration D1 → D1 depuis les Paramètres : copie company-stock-db → atlas-db par lots reprises, puis bascule réversible' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '048c1', text: 'Modales toujours centrées verticalement + bouton de fermeture visible et thémé (appareils connectés inclus)' },
          { id: '048c2', text: 'Cartes « Permissions Atlas Agent » lisibles en clair ET sombre ; doublon de titre supprimé' },
        ],
      },
    ],
  },
  {
    version: '0.4.7-beta',
    date: '21 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '047a1', text: 'Quotas de jetons en Durable Object : persistants aux redéploiements, migration automatique des anciennes valeurs D1' },
          { id: '047a2', text: 'Agent : markdown rendu, pièces jointes annotables (éditeur texte/dessin), stockage chiffré AES-GCM des conversations dans R2' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '047b1', text: 'Popups guidés unifiés (wizard) : pied droit, chip d’étape compacte, erreurs inline, clic extérieur = annulation sans persister' },
        ],
      },
    ],
  },
  {
    version: '0.4.6-beta',
    date: '20 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '046a1', text: 'Gouvernance de l’agent : 2FA, appareils connectés, suppressions gated par OTP, verrouillage anti-injection rétabli par admin' },
          { id: '046a2', text: 'Plafonds de jetons jour/semaine (admin exempté et pilote)' },
        ],
      },
    ],
  },
  {
    version: '0.4.5-beta',
    date: '20 octobre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '045b1', text: 'Palette zinc unique en sombre : zéro flash blanc, boutons primaires clairs, focus et appuis zinc, transition circulaire du thème' },
        ],
      },
    ],
  },
  {
    version: '0.0.1-beta',
    date: 'première version',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '001a1', text: 'Première version interne (bêta) : stock, facturation et espace de travail Atlas Commerce' },
        ],
      },
    ],
  },
];

const KIND_META: Record<
  SectionKind,
  { title: string; icon: typeof Sparkles; color: string; bg: string; filter: string; tone: string }
> = {
  features: {
    title: 'Nouveautés',
    icon: Sparkles,
    color: '#0a0a0a',
    bg: '#e7e7e7',
    filter: 'added',
    tone: 'feature',
  },
  improvements: {
    title: 'Améliorations',
    icon: ArrowUpCircle,
    color: '#171717',
    bg: '#ececec',
    filter: 'improved',
    tone: 'improve',
  },
  fixes: {
    title: 'Corrections',
    icon: Wrench,
    color: '#262626',
    bg: '#f0f0f0',
    filter: 'fixed',
    tone: 'fix',
  },
  breaking: {
    title: 'Changements majeurs',
    icon: AlertCircle,
    color: '#b91c1c',
    bg: '#fee2e2',
    filter: 'all',
    tone: 'break',
  },
};

export default function WhatsNew() {
  const [params] = useSearchParams();
  const filter = params.get('f') || 'all';

  useEffect(() => {
    markWhatsNewSeen();
  }, []);

  const releases = useMemo(() => {
    return RELEASES.map((rel) => ({
      ...rel,
      sections: rel.sections.filter((sec) => {
        if (filter === 'all') return true;
        const meta = KIND_META[sec.kind];
        return meta.filter === filter;
      }),
    })).filter((rel) => rel.sections.length > 0);
  }, [filter]);

  return (
    <div className="wn-changelog">
      <nav className="wn-crumb" aria-label="Fil d'Ariane">
        <Link to="/">Accueil</Link>
        <span aria-hidden>›</span>
        <span>Nouveautés</span>
      </nav>

      <motion.h1
        className="wn-title"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Nouveautés
      </motion.h1>
      <p className="wn-lead">
        Version actuelle <strong>{APP_VERSION}</strong>
        {APP_BUILD_DATE ? ` · ${APP_BUILD_DATE}` : ''}. Historique depuis la 0.0.1.
      </p>

      <div className="wn-releases">
        {releases.map((rel, ri) => (
          <motion.section
            key={rel.version}
            className="wn-release"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(ri * 0.02, 0.4), duration: 0.28 }}
          >
            <h2 className="wn-ver">
              {rel.version} <span className="wn-ver-date">— {rel.date}</span>
            </h2>
            {rel.sections.map((sec) => {
              const meta = KIND_META[sec.kind];
              const Icon = meta.icon;
              return (
                <div key={sec.kind + rel.version} className="wn-sec">
                  <div className="wn-sec-head">
                    <span className={`wn-sec-ico wn-sec-ico--${meta.tone}`} style={{ background: meta.bg, color: meta.color }}>
                      <Icon size={16} strokeWidth={2.2} />
                    </span>
                    <h3>{meta.title}</h3>
                  </div>
                  <ul className="wn-list">
                    {sec.items.map((it) => (
                      <li key={it.id}>
                        <span>{it.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </motion.section>
        ))}
        {releases.length === 0 && (
          <p className="wn-lead">Aucun élément pour ce filtre.</p>
        )}
      </div>
    </div>
  );
}
