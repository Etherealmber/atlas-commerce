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
    version: '1.4.3-beta',
    date: '11 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '143a1', text: 'Thème sombre unifié (sidebar, topbar et pages sur la même palette zinc)' },
          { id: '143a2', text: 'Fichier CSS final dark-force pour éviter les conflits de cascade' },
          { id: '143a3', text: 'assetlinks.json restauré avec empreinte SHA-256 pour passkeys Android' },
          { id: '143a4', text: 'Enregistrement passkey depuis le téléphone (session connectée, sans 403 appareil non de confiance)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '143b1', text: 'Menus compte, mail et notifications entièrement adaptés au thème sombre' },
          { id: '143b2', text: 'Plus de flash blanc au survol / au toucher des boutons en mode sombre' },
          { id: '143b3', text: 'Texte secondaire neutre (gris) — plus de violet/indigo par défaut' },
          { id: '143b4', text: 'Squelettes de chargement neutres (clair et sombre)' },
          { id: '143b5', text: 'Page Nouveautés : icônes et textes lisibles en clair et en sombre' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '143c1', text: 'Lignes blanches dans le pop-up Messagerie en thème sombre' },
          { id: '143c2', text: 'Éléments blancs du menu utilisateur (Paramètres, Nouveautés, Déconnexion)' },
          { id: '143c3', text: 'focus-pages-chrome.css qui forçait le blanc sur Paramètres en sombre' },
          { id: '143c4', text: 'Arrière-plans verdâtres (#0b100e) retirés du thème sombre' },
          { id: '143c5', text: 'Cartes KPI du tableau de bord avec la même surface' },
        ],
      },
    ],
  },
  {
    version: '1.4.2-beta',

    date: '7 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'a1', text: 'États vides avec un bouton clair pour créer (devis, reçus, fournisseurs…)' },
          { id: 'a2', text: 'Navigation regroupée par thèmes (Catalogue, Ventes, Achats, Finance)' },
          { id: 'a3', text: 'Barre mobile plus confortable (gros boutons, libellés Accueil / Caisse / Réglages)' },
          { id: 'a4', text: 'Favicon et icône d’accueil iPhone générés depuis le logo Atlas' },
          { id: 'a5', text: 'Titre unique par page dans l’onglet du navigateur' },
          { id: 'a6', text: 'Aperçu Open Graph / Twitter pour le partage de liens' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: 'b1', text: 'Boutons d’action plus parlants (« Ajouter un produit », « Entrer dans Atlas »…)' },
          { id: 'b2', text: 'Export Excel CSV en style blanc, aligné avec PDF Stock et Réassort' },
          { id: 'b3', text: 'Pagination : flèches blanches au repos, noires au survol uniquement' },
          { id: 'b4', text: 'Recherche produits plus précise (index de recherche)' },
          { id: 'b5', text: 'Couleurs d’accent unifiées sur le noir de marque (plus de bleu par défaut)' },
          { id: 'b6', text: 'Cibles tactiles plus grandes sur téléphone' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'c1', text: 'Textes des états vides qui restaient dans leur carte' },
          { id: 'c2', text: 'Messages d’erreur techniques masqués (plus de détail base de données)' },
          { id: 'c3', text: 'Erreur « Erreur interne » au chargement produits en cas d’échec recherche' },
          { id: 'c4', text: 'Boutons de filtre Nouveautés opérationnels (Tout / Ajouté / Amélioré / Corrigé)' },
        ],
      },
    ],
  },
  {
    version: '1.4.1-beta',
    date: '6 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'd1', text: 'Restauration de sauvegarde plus rapide (ignore ce qui existe déjà)' },
          { id: 'd2', text: 'Fenêtre de restauration fixe au centre, avec le détail de progression' },
          { id: 'd3', text: 'Rédaction d’e-mails (nouveau, répondre, transférer) en fenêtre centrée' },
          { id: 'd4', text: 'Export CSV / rapports avec étapes animées' },
          { id: 'd5', text: 'Pagination avec chiffres animés' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: 'e1', text: 'Graphiques du tableau de bord et du solde sur données réelles' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'f1', text: 'Chiffres du compte à rebours Supprimer bien visibles (blanc)' },
          { id: 'f2', text: 'Boutons Supprimer toujours rouges' },
          { id: 'f3', text: 'Pagination « N sur M » stable, sans saut de mise en page' },
        ],
      },
    ],
  },,
  {
    version: '1.4.0-beta',
    date: '1er octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'a1b2c3d', text: 'Shell revisité : top bar, menu avatar, notifications, recherche' },
          { id: 'e5f6g7h', text: 'Suppression temporisée rouge (10 s) — annulation si onglet masqué' },
          { id: 'i8j9k0l', text: 'Nouveaux graphiques tableau de bord et solde (barres, données live)' },
          { id: 'm1n2o3p', text: 'Atlas Agent : PromptBar, LatticeLoader, historique R2 (30 j)' },
          { id: 'p4q5r6s', text: 'Pagination pilule (N sur M) — listes & messagerie' },
          { id: 't7u8v9w', text: 'Changelog Nouveautés (sections Nouveautés / Corrections / Majeurs)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'x0y1z2a', text: 'Purge liquid glass, teal et résidus verts (web + mobile)' },
          { id: 'b3c4d5e', text: 'Login Auth7, cases noires, personnages ; barre Agent lisible' },
          { id: 'f6g7h8i', text: 'Bouton Supprimer fixe (plus de troncature ni saut de layout)' },
        ],
      },
    ],
  },
  {
    version: '1.3.4-beta',
    date: '28 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'j9k0l1m', text: 'Erreurs de formulaire en français dans la popup' },
          { id: 'n2o3p4q', text: 'Atlas Agent masqué pendant les modales' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'r5s6t7u', text: 'Remboursement centré, flou plein écran' },
          { id: 'v8w9x0y', text: 'Popups mal centrées sur plusieurs pages' },
        ],
      },
    ],
  },
  {
    version: '1.3.3-beta',
    date: '26 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'z1a2b3c', text: 'Messagerie focus (top bar, sans sidebar app)' },
          { id: 'd4e5f6g', text: 'Scanner Quagga2' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'h7i8j9k', text: 'Filtres boîte / envoyés / tous ; spam & archives' },
          { id: 'l0m1n2o', text: 'Pagination messagerie sans fuite entre pages' },
        ],
      },
    ],
  },
  {
    version: '1.3.2-beta',
    date: '25 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p3q4r5s', text: 'Recherche Paramètres (historique, aperçu)' },
          { id: 't6u7v8w', text: 'Atlas Agent mobile + barre du bas fixe' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'x9y0z1a', text: 'PBKDF2 Workers (itérations supportées)' },
          { id: 'b2c3d4e', text: 'Scan caméra / WASM réseau' },
        ],
      },
    ],
  },
  {
    version: '1.3.1-beta',
    date: '22 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'f5g6h7i', text: 'Mode focus Paramètres / À propos / Nouveautés' },
          { id: 'j8k9l0m', text: 'Page Nouveautés + menu utilisateur' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'n1o2p3q', text: 'Animations de page et transitions shell' },
        ],
      },
    ],
  },
  {
    version: '1.2.0-beta',
    date: '15 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'r4s5t6u', text: 'Employés, cycles de paie, acomptes' },
          { id: 'v7w8x9y', text: 'Présence / pointage (option Paramètres)' },
          { id: 'z0a1b2c', text: 'Fiche employé imprimable + pièce ID chiffrée R2' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'd3e4f5g', text: 'Numérotation Durable Object ; refresh listes' },
        ],
      },
    ],
  },
  {
    version: '1.1.9-beta',
    date: '8 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'h6i7j8k', text: 'Boîte mail pro (dossiers, pièces jointes, spam)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'l9m0n1o', text: 'Lecture corps mail pleine page (scroll document)' },
        ],
      },
    ],
  },
  {
    version: '1.1.8-beta',
    date: '5 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p2q3r4s', text: 'Aperçu documents (PDF / images) dans la messagerie' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 't5u6v7w', text: 'Styles boutons secondaires (refresh) unifiés' },
        ],
      },
    ],
  },
  {
    version: '1.1.7-beta',
    date: '2 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'x8y9z0a', text: 'Rapports stock / ventes ; historique produit' },
        ],
      },
    ],
  },
  {
    version: '1.1.6-beta',
    date: '28 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'b1c2d3e', text: 'Reçus, remboursements, vente rapide' },
        ],
      },
    ],
  },
  {
    version: '1.1.5-beta',
    date: '22 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'f4g5h6i', text: 'Devis convertibles ; factures FA / VR' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'j7k8l9m', text: 'Calcul HT/TTC et libellés prix' },
        ],
      },
    ],
  },
  {
    version: '1.1.4-beta',
    date: '18 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'n0o1p2q', text: 'Clients, fournisseurs, crédit client' },
        ],
      },
    ],
  },
  {
    version: '1.1.3-beta',
    date: '14 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'r3s4t5u', text: 'Achats fournisseurs + réception stock' },
        ],
      },
    ],
  },
  {
    version: '1.1.2-beta',
    date: '10 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'v6w7x8y', text: 'Solde trésorerie (recettes, dépenses, apports)' },
        ],
      },
    ],
  },
  {
    version: '1.1.1-beta',
    date: '6 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'z9a0b1c', text: 'Catalogue produits, catégories, images R2' },
        ],
      },
    ],
  },
  {
    version: '1.0.9-beta',
    date: '2 août 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: 'd2e3f4g', text: 'Stabilisation auth session et cookies' },
        ],
      },
    ],
  },
  {
    version: '1.0.5-beta',
    date: '30 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'h5i6j7k', text: 'Tableau de bord métriques de base' },
        ],
      },
    ],
  },
  {
    version: '1.0.1-beta',
    date: '28 juillet 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: 'l8m9n0o', text: 'Correctifs post-publication login / routing' },
        ],
      },
    ],
  },
  {
    version: '1.0.0-beta',
    date: '27 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p1q2r3s', text: 'Première publication Atlas Commerce (stock, caisse, facturation)' },
        ],
      },
      {
        kind: 'breaking',
        items: [
          { id: 't4u5v6w', text: 'Canal beta uniquement — versions stables à venir' },
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
        {APP_BUILD_DATE ? ` · ${APP_BUILD_DATE}` : ''}. Historique depuis la 1.0.0.
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
