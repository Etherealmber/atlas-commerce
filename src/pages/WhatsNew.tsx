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
    version: '0.4.10-beta',
    date: '22 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '0410c1', text: '« Erreur interne — réessayez plus tard » sur l’enregistrement d’un produit : la migration optionnelle de la colonne des remises par quantité ne peut plus faire échouer la sauvegarde (PUT/POST produits blindés)' },
          { id: '0410c2', text: 'Les erreurs de sauvegarde s’affichent désormais dans la zone prévue de la fenêtre (bannière rouge au-dessus des boutons) — Produits, Facturation et Vente rapide ne passent plus par un toast masqué par le pied de l’assistant' },
          { id: '0410c3', text: 'Le journal réel de l’erreur reste côté serveur (logs Cloudflare) : plus aucun message SQL/interne exposé au client, mais la cause est tracée pour le débogage' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '0410b1', text: 'Les notifications flottantes passent en haut de l’écran : elles ne se retrouvent plus jamais derrière les pieds de fenêtre ou les barres collantes' },
        ],
      },
    ],
  },
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
    version: '1.4.5-beta',
    date: '20 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '145a1', text: 'Tous les popups suivent le même système guidé : produit (3 étapes), facture d’achat (3 étapes), remboursement WR (2 étapes), reçu et fournisseur (2 étapes) — Annuler / Retour / Continuer toujours alignés à droite' },
          { id: '145a2', text: 'Éditeur photo : zoom − / + / 1:1, double-clic ×2 et bouton « ↩ Original » pour revenir à la photo d’origine à tout moment' },
          { id: '145a3', text: 'Zone de dépôt OCR redesignée (facture d’achat) : carte pointillée claire/sombre avec icône et aide au survol' },
          { id: '145a4', text: 'Transition de thème façon PowerPoint : révélation circulaire depuis le centre de la fenêtre (View Transitions), sans blanc au chargement' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '145b1', text: 'Zéro flash blanc : le thème enregistré est appliqué avant le premier rendu (page, squelettes, sélecteur de date)' },
          { id: '145b2', text: 'Palette zinc unique en sombre : boutons primaires clairs (fini le noir/bleu marine), segments Apparence lisibles, focus et appuis zinc' },
          { id: '145b3', text: 'Notes d’information des popups (WR, statuts de paiement) thémées : texte toujours lisible en clair et en sombre' },
          { id: '145b4', text: 'Animations sobres : appui bouton, survol des cartes, pop des modales, squelettes décalés — désactivées si mouvement réduit' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '145c1', text: 'Le tap hors d’un popup annule et réinitialise le formulaire (jamais d’enregistrement accidentel)' },
          { id: '145c2', text: 'Erreurs affichées sous leur champ dans le popup (scan code-barres, lignes vides, montant de règlement)' },
          { id: '145c3', text: 'Page Nouvelles : canevas sombre complet + entrée 1.4.5 (le gris clair résiduel a disparu)' },
          { id: '145c4', text: 'Fiabilité worker : /api/public/github-profile mis en cache 6 h avec repli statique (plus de 503) ; migrations D1 silencieuses (PRAGMA d’abord)' },
        ],
      },
    ],
  },
  {
    version: '1.4.4-beta',
    date: '20 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '144a1', text: 'Scan : code inconnu → demande de création produit (photo comprise), validée depuis la liste Produits' },
          { id: '144a2', text: 'Mises à jour de l’application Android gérées depuis Paramètres (lien + APK via le serveur)' },
          { id: '144a3', text: 'Formulaires guidés par étapes (employés) avec barre d’actions fixe : Retour / Continuer toujours au même endroit' },
          { id: '144a4', text: 'Atlas Agent : « créer un client nommé X avec email/téléphone » ouvre directement la fiche pré-remplie à vérifier' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '144b1', text: 'Thème sombre unifié partout : une seule palette zinc (fini les fonds bleu marine)' },
          { id: '144b2', text: 'Menu du compte, sélecteur de dates (y compris plage) et boutons de période entièrement sombres' },
          { id: '144b3', text: 'Suppressions et créations sensibles : simple confirmation, plus de mot de passe à ressaisir (la session + OTP protègent déjà)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '144c1', text: 'Synchronisation des conversations Atlas Agent restaurée (erreur 404 sur les threads)' },
          { id: '144c2', text: 'Page Nouveautés : entrée fantôme qui faisait plancher l’affichage corrigée' },
          { id: '144c3', text: 'Tableau de bord : plus d’erreur 403 quand le module Pointage est désactivé' },
        ],
      },
    ],
  },
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
  },
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
          { id: 'x0y1z2a', text: 'Purge des effets de verre, teal et résidus verts (web + mobile)' },
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
