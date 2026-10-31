import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Wrench, AlertCircle, ArrowUpCircle } from 'lucide-react';
import { RELEASE_VISIBLE_CAP, semverAtMost } from '../version';
import { markWhatsNewSeen } from '../lib/whatsNew';
import { isLoggedIn, getToken } from '../auth';

type SectionKind = 'features' | 'improvements' | 'fixes' | 'breaking';

type Platform = 'web' | 'android' | 'desktop' | 'server';

const PLAT_LABEL: Record<Platform, string> = {
  web: 'Web',
  android: 'Android',
  desktop: 'Desktop',
  server: 'Serveur',
};

type Section = {
  kind: SectionKind;
  items: { id: string; text: string; platforms?: Platform[] }[];
};

type Release = {
  version: string;
  date: string;
  sections: Section[];
};


export const RELEASES: Release[] = [
  {
    version: '0.7.7-beta',
    date: '30 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '077f1', platforms: ['web'], text: '« / » ne redirige plus les utilisateurs connectés : la homepage publique reste visible même en session — la page d’ouverture ne s’applique qu’au moment de la connexion (et dans la PWA / la WebView Android)' },
          { id: '077f2', platforms: ['web'], text: 'À propos et Nouveautés affichent exactement la même navigation qu’un visiteur non connecté (Accueil · Bureau · Android · …) : plus de rangée de liens « connectés » ni de bouton « Tableau de bord » sur ces pages ; seul le bouton Se connecter / Ouvrir l’app suit la session' },
          { id: '077f3', platforms: ['web'], text: 'Accueil : un seul bouton GitHub dans le pied de page (le doublon a disparu) ; plus aucun CTA souligné (« Voir les nouveautés », cartes « Construit en public ») — tout passe en chips/boutons' },
          { id: '077f4', platforms: ['web', 'server'], text: 'Le téléchargement APK depuis l’accueil lit désormais le manifeste R2 `latest.json` (cdn1.afmarbre.com/app-updates/android/latest.json) — la même source que consulte l’appli Android pour ses mises à jour — avec repli sur le manifeste local' },
          { id: '077f5', platforms: ['web'], text: '/download et /desktop suivent enfin le vrai thème Atlas (zinc + terracotta) en clair comme en sombre : cartes, bandes, textes et liens remappés sur la palette du dashboard' },
          { id: '077f6', platforms: ['web'], text: 'Connecté, le CTA « Ouvrir l’app » disparaît des pages publiques : la pilule affiche à la place la chip profil (initiales + nom + rôle), identique à celle des Paramètres, sur À propos, Nouveautés et toutes les pages publiques' },
          { id: '077f7', platforms: ['web'], text: 'À propos : un seul logo (le hero ne duplicate plus celui de la nav) ; carte créateur « Etherealmber » (plus jamais Haytam ni loxdpsy) ; liste de dépôts limitée aux trois demandés — afmarbre-main, atlas-commerce-android, atlas-commerce-desktop' },
          { id: '077f8', platforms: ['web'], text: 'Connecté, /about et /whats-new ne passent plus jamais par le shell : le bouton « ← Tableau de bord » résiduel a disparu définitivement de ces deux pages (routes descendantes du shell supprimées)' },
          { id: '077f9', platforms: ['web'], text: 'Topbar Paramètres sur UNE seule ligne (le repli en deux rangées est corrigé) et elle rétrécit désormais au scroll descendant / grandit en remontant, comme la pilule publique' },
          { id: '077i6', platforms: ['web'], text: 'La chip profil des pages publiques affiche la vraie photo de l’utilisateur (AvatarImage, repli initiales) — identique à celle des Paramètres' },
          { id: '077i7', platforms: ['web'], text: 'Arc du dossier piloté par le scroll : les sept modules (Caisse, Stock, Facturation, Scan & OCR, Agent IA, WebAuthn, Rapports — avec libellés) sortent véritablement du folder à mesure qu’on descend dans la section ; positions statiques si prefers-reduced-motion' },
          { id: '077i8', platforms: ['web'], text: 'Page À propos centrée (hero, puces technologies, cartes Support/Hébergement) et correctifs mobile : arc du dossier et arc « tout-en-un » redimensionnés et repositionnés sous 700 px, cartes À propos en une colonne, paddings Nouveautés resserrés' },
          { id: '077f10', platforms: ['web'], text: 'La page de téléchargement Android déménage : /android est la nouvelle adresse (tous les liens mis à jour), /download redirige automatiquement — cookies, teaser et CTA suivent' },
          { id: '077f11', platforms: ['web'], text: 'Paramètres : le bloc-titre « Espace de travail / Paramètres / Identité, fiscalité… » est supprimé (la topbar porte déjà ces informations) et les onglets de la topbar tiennent désormais sur une seule ligne' },
          { id: '077i9', platforms: ['web'], text: 'Connecté, une carte flottante SÉPARÉE apparaît à côté de la pilule sur À propos et Nouveautés : raccourcis « Tableau de bord » et « Paramètres » (icônes seules sur mobile) ; la chip profil publique est fiabilisée (slot avatar 26 px fixe, nom/rôle ellipsés)' },
          { id: '077f12', platforms: ['web'], text: 'Raccourcis connectés : rangée d’icônes façon onglets Paramètres (Tableau de bord, Vente rapide, Produits, Factures, Clients, Rapports) ancrée À DROITE de la pilule, uniquement sur À propos / Nouveautés et uniquement connecté — sans bouton Paramètres' },
          { id: '077f13', platforms: ['web'], text: 'La chip profil publique devient un vrai menu déroulant (comme aux Paramètres) : Tableau de bord, À propos, Nouveautés et Déconnexion — avatar/logo visible sur toutes les pages' },
          { id: '077f14', platforms: ['web'], text: 'Topbar Paramètres élargie (1560 px) et onglets forcés sur UNE seule ligne (fin du wrap venu de dark-force) ; icônes resserrées sous 1500 px' },
          { id: '077f15', platforms: ['web'], text: 'Fin du scintillement des topbars au scroll : le passage compact/normal exige désormais 48 px de scroll cumulés dans une direction (hystérésis), sur la pilule publique comme sur la topbar Paramètres' },
          { id: '077i10', platforms: ['web'], text: 'Recherche globale : taper la recherche (Paramètres ou pilule publique) ouvre un PANNEAU LATÉRAL animé qui cherche vraiment partout — pages, routes, produits, clients, factures — avec le même sélecteur que le sélecteur de produits des popups (`.atlas-typeahead`), clavier ↑↓/Entrée/Échap' },
          { id: '077i11', platforms: ['web'], text: 'Le panneau recherche et l’Atlas Agent se superposent dans l’ordre d’ouverture (compteur de couches : jamais de boucle, aucun ne ferme l’autre)' },
          { id: '077i12', platforms: ['web'], text: 'Pilule publique unifiée sur le style Paramètres : connecté, onglets icônes (Tableau de bord, Vente rapide, Produits, Factures, Clients, Rapports) + bouton recherche dans la barre ; la carte de raccourcis séparée disparaît ; visiteur = liens texte façon accueil' },
          { id: '077i13', platforms: ['web'], text: 'Recherche globale : plus aucun résultat affiché avant la première frappe ; l’historique de recherche est enregistré sur l’appareil (cache local), réutilisable et supprimable entrée par entrée ou en totalité' },
          { id: '077i14', platforms: ['web'], text: 'La recherche des Paramètres devient une simple icône ; une icône recherche identique ouvre le panneau global depuis le tableau de bord et toutes les pages de l’application' },
          { id: '077i15', platforms: ['web'], text: 'Barre du haut (À propos / Nouveautés) : liens utiles uniquement — Conditions d’utilisation, Confidentialité, GitHub, Guide d’accueil, Cookies — avec exactement les mêmes boutons que la topbar Paramètres ; la page en cours et les doublons de la sidebar disparaissent, y compris dans le menu du compte' },
          { id: '077i16', platforms: ['web'], text: 'Filtres du journal des nouveautés lisibles en thème clair (les pastilles n’apparaissent plus en noir)' },
          { id: '077i17', platforms: ['web'], text: 'La photo de profil s’affiche de nouveau dans la pastille de compte publique (initiales en base, image réelle par-dessus)' },
          { id: '077i18', platforms: ['web'], text: 'Atlas Agent : quand l’accès est suspendu (abus ou injection de prompt détectée), la barre de saisie est masquée — seul l’avis de verrouillage reste visible' },
          { id: '077i19', platforms: ['web'], text: 'À propos et Nouveautés : l’ancienne barre pill disparaît au profit de la topbar Paramètres littérale — collante en haut, toujours visible au scroll et plus compacte quand on descend (sans scintillement)' },
          { id: '077i20', platforms: ['web'], text: 'Un seul bouton recherche partout : doublon retiré de la topbar Paramètres ; accueil, bureau et Android n’affichent plus de bouton recherche' },
          { id: '077i21', platforms: ['web'], text: 'Nouveautés : les filtres Tout / Nouveautés / Améliorations / Corrections montent DANS la topbar (pastilles lisibles en clair comme en sombre) et le bouton « copier le lien » à côté de chaque version disparaît' },
          { id: '077i22', platforms: ['web'], text: 'Topbar À propos / Nouveautés : fixe en haut — toujours visible en scrollant, plus compacte en descendant ; le bouton recherche (collé au sélecteur de thème) ouvre enfin le panneau global sur ces pages' },
          { id: '077i23', platforms: ['web'], text: 'La photo de profil s’affiche dans la pastille de compte des pages publiques (le cache profil est réchauffé dès l’arrivée sur la page, plus de rond noir aux initiales)' },
          { id: '077i24', platforms: ['web', 'server'], text: 'Atlas Agent doté d’un savoir persistant : MÉMOIRE par utilisateur, CONTEXTE métier, GARDE-FOUS impératifs, OUTILS activables et base de connaissances RAG — tout se consulte et s’édite dans Paramètres → Intégrations → « Mémoire & savoir de l’Agent »' },
          { id: '077i25', platforms: ['server'], text: 'L’Agent appelle désormais de vrais outils en conversation (boucle function-calling Groq, 3 tours max, trace visible) : outils métier selon le rôle + save_memory / recall_memory / search_knowledge ; les outils coupés dans les Paramètres sont exclus côté serveur' },
          { id: '077i26', platforms: ['web'], text: 'Accès Agent suspendu : un popup dédié explique le verrouillage (une fois par session) en plus de l’avis dans le panneau ; la page À propos affiche la carte Créateur enrichie (abonnés, dépôts, étoiles) avec bouton « Profil GitHub »' },
          { id: '077i27', platforms: ['web'], text: 'Nouvel onglet « Atlas Agent » dans les Paramètres : mémoire & savoir, sécurité & quotas, permissions et provider Groq réunis au même endroit (recherche Paramètres mise à jour)' },
          { id: '077i28', platforms: ['web'], text: '« Accès agent des utilisateurs » s’ouvre désormais en popup, comme les appareils connectés : liste des comptes, statut, Suspendre / Rétablir ; les cartes de permissions ne s’affichent plus noires (clair et sombre)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '077i1', platforms: ['web'], text: 'La barre des Paramètres adopte le même langage que la navigation publique : pilule flottante en blur, bordures et fonds zinc/terracotta selon le thème — tout en gardant les onglets de sections, la recherche, le toggle de thème et le profil utilisateur' },
          { id: '077i2', platforms: ['web'], text: 'Nouvelle section « Un dossier. Tout votre commerce. » : sept modules en arc qui sortent d’un dossier portant le logo Atlas (animation d’élévation puis flottement, désactivée si prefers-reduced-motion)' },
          { id: '077i3', platforms: ['web'], text: 'Le toggle de thème des pages publiques est désormais STRICTEMENT le même trio que celui du dashboard (.settings-topbar-theme), actif terracotta partout' },
          { id: '077i4', platforms: ['web'], text: 'Gel de la version affichée (directive) : « 0.7.2 » partout où une version est montrée ; journal Nouveautés et modal limités aux entrées ≤ 0.7.2 ; plus aucun bump de version sans ordre explicite' },
          { id: '077i5', platforms: ['web'], text: 'La pilule de navigation publique rétrécit quand on descend (logo, paddings et liens compactés) et reprend sa taille dès qu’on remonte — sur toutes les pages qui l’utilisent (accueil, À propos, Nouveautés, Bureau, Android)' },
        ],
      },
    ],
  },
  {
    version: '0.7.6-beta',
    date: '30 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '076a1', platforms: ['web'], text: 'Page d’ouverture au choix : Paramètres → « Page d’ouverture » (tableau de bord, caisse, stock, clients, factures, créances, rapports, paramètres ou vitrine publique) — appliquée après la connexion et en ouvrant « / » connecté ; réglage local par appareil, fonctionnel en auto-hébergement sans aucun réglage serveur' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '076i1', platforms: ['web'], text: 'À propos et Nouveautés portent la même barre flottante que l’accueil, connectés comme visiteurs (liens adaptés à la session), et suivent le vrai thème Atlas zinc/terracotta au lieu du rendu « README »' },
          { id: '076i2', platforms: ['web'], text: 'Chrome public rendu 100 % en styles inline : logo unique selon le thème, toggle système/clair/sombre et bouton de téléchargement scindé immunisés contre toute cascade CSS (fini pastilles noires, caret détaché et soulignements) ; les téléchargements sont de vrais boutons, plus des liens' },
          { id: '076i3', platforms: ['server'], text: 'Patrol sécurité : un challenge WAF sur l’UA du runner ne produit plus de CRITICAL trompeur — re-sonde avec un UA navigateur, passe avec avis d’allowlist si le site répond, et reste CRITICAL seulement si les visiteurs sont bloqués eux aussi' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '076f1', platforms: ['web'], text: 'Connecté, /login renvoie désormais vers la page d’ouverture (tableau de bord par défaut) au lieu de la vitrine ; idem à la fin de l’assistant de premier lancement' },
          { id: '076f2', platforms: ['web'], text: 'Carte « Agent IA » de l’accueil : la question part de l’utilisateur (bulle envoyée) et c’est l’IA qui répond (bulle reçue)' },
          { id: '076f3', platforms: ['web'], text: 'Mentions « version · date · liens » retirées d’À propos, Nouveautés et Paramètres pour tout le monde, en attendant la prochaine mise à jour demandée' },
        ],
      },
    ],
  },
  {
    version: '0.7.5-beta',
    date: '30 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '075f1', platforms: ['web'], text: 'Tableau de bord réparé : la route /dashboard affichait une page vide et pouvait figer l’onglet (boucle de navigation « Throttling navigation ») — les Routes descendants du shell reçoit désormais le suffixe /* et le reste « / » rend directement le dashboard ; la navigation latérale répond à nouveau normalement' },
          { id: '075f2', platforms: ['web', 'server'], text: 'Sécurité : révoquer un appareil (« Appareils connectés ») coupe désormais sa session en cours — le serveur rejette en 401 DEVICE_REVOKED toute requête authentifiée dont l’empreinte n’est plus dans les appareils de confiance ; l’app Android se déconnecte toute seule au prochain appel, une reconnexion restaure l’accès' },
          { id: '075f3', platforms: ['web'], text: 'Boutons de thème et bouton de téléchargement scindé réparés sur les pages publiques : plus de pastilles grises détachées, le caret reste soudé au bouton principal et le segment actif du toggle (système/clair/sombre) se voit clairement' },
          { id: '075f4', platforms: ['web'], text: 'La ligne « version · date · Nouveautés · À propos » disparaît pour les utilisateurs connectés sur À propos, Nouveautés et Paramètres (elle reste visible des visiteurs publics)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '075i1', platforms: ['web'], text: 'Accueil : vrai QR code scannable (logo Atlas au centre) pointant vers la vérification publique, icônes SVG dessinées à la main partout à la place des emojis (arc « tout-en-un », cartes plateformes et dépôts) et fond du hero animé en canvas façon Liner, désactivé si prefers-reduced-motion' },
        ],
      },
    ],
  },
  {
    version: '0.7.4-beta',
    date: '30 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '074a1', platforms: ['web'], text: 'Pages publiques repensées (/, /desktop, /download) : navigation flottante en pilule, hero géant avec aperçu du tableau de bord, bouton de téléchargement scindé qui détecte votre appareil (« Télécharger pour Windows / macOS / Linux / Android ») avec menu des autres plateformes, bouton GitHub avec compteur d’étoiles, cartes bento des fonctionnalités, section « tout-en-un » (le cahier, Excel, Word, la calculatrice et WhatsApp remplacés par Atlas), FAQ en accordéon et CTA final' },
          { id: '074a2', platforms: ['web'], text: 'Responsive complet des pages publiques : téléphones pliables (écran couvert étroit et écran ouvert), phones, tablettes et iPad, Chromebooks, très grands écrans et TV — la mise en page s’adapte de 280 px à 2400 px et plus' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '074i1', platforms: ['web'], text: 'Employés : formulaire simplifié — les champs « N° employé » (généré automatiquement) et « Nom affiché » disparaissent ; le nom complet (prénom + nom de famille) fait foi partout, et les listes denses abrègent automatiquement les noms trop longs (prénom + initiales du nom de famille) avec le nom complet au survol' },
          { id: '074i2', platforms: ['server'], text: 'Imprimé employé : la zone de signature indique simplement « Employeur » au lieu de « Visa employeur »' },
          { id: '074i3', platforms: ['web'], text: 'Sélecteur de thème des pages publiques en icônes SVG (système · clair · sombre) à la place des emojis ; le choix « clair » est désormais conservé après rechargement' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '074f1', platforms: ['web'], text: 'Nationalité des employés : le champ « Préciser la nationalité » n’apparaît plus en même temps que « Marocaine » — il faut choisir explicitement « Autre » pour le voir' },
          { id: '074f2', platforms: ['web', 'server'], text: 'Signalement de bugs invisible pour les visiteurs non connectés : le formulaire « Signaler un problème » ne s’affiche plus sur les pages publiques et aucun rapport de plantage n’est envoyé sans session ouverte' },
        ],
      },
    ],
  },
  {
    version: '0.7.3-beta',
    date: '30 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '073a1', platforms: ['web'], text: 'Accueil public sur stock.afmarbre.com : la page / présente le produit (comment ça marche, fonctionnalités), les trois apps Web · Android · Bureau et le bloc open source avec bouton Fork — sans cookie et sans aucune redirection vers login ou dashboard' },
          { id: '073a2', platforms: ['web', 'desktop'], text: 'Nouvelle page /desktop : installateurs bureau officiels (Windows .msi/.exe, macOS .dmg, Linux AppImage) lus depuis GitHub Releases avec détection de votre système, fichiers de la version, notes et historique — même gabarit que /download' },
          { id: '073a3', platforms: ['web'], text: 'Route /dashboard explicite : l’application s’ouvre désormais sur cette adresse après connexion ; la racine reste l’accueil public. L’app Android installée et la PWA continuent de s’ouvrir directement dans l’app' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '073i1', platforms: ['web'], text: 'Thème : premier lancement sur « système » par défaut (suit clair/sombre de l’OS, mis à jour en direct) ; accueil et /desktop gagnent un sélecteur système/clair/sombre, une palette claire complète et des révélations animées respectueuses de prefers-reduced-motion' },
        ],
      },
    ],
  },
  {
    version: '0.7.2-beta',
    date: '29 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '072a1', platforms: ['server'], text: 'OTP obligatoire à chaque connexion par mot de passe (owner inclus) : fin du bypass « appareil de confiance », premier login d’un compte neuf compris ; le code part sur l’e-mail du compte, sinon sur l’e-mail principal de la société' },
          { id: '072a2', platforms: ['server', 'android'], text: 'Ajustements de stock : circuit de demandes approbées (POST/GET /api/stock-adjustment-requests, approve/reject owner·admin·secrétaire, application atomique + audit) ; l’écran Notifications Android liste les demandes pendantes' },
          { id: '072a3', platforms: ['web'], text: 'Aperçus PDF au vrai format par type (reçu, avoir/WR, fiche employé, rapport) avec QR, données démo marquées DÉMO, sans impression automatique et liens ouverts dans le popup' },
          { id: '072a4', platforms: ['web'], text: 'L’aperçu Rapport suit désormais le vrai rapport combiné : liste des 7 rapports détaillés, sections Solde & mouvements, Créances, Dettes, Employés & paie, liens ouverts dans le popup et jeu de données démo cohérent (client, articles, reçu, employé) avec avertissement permanent' },
          { id: '072a5', platforms: ['server'], text: 'Le reçu en aperçu affiche le QR « situation client » quand l’option est activée, exactement comme le reçu réel : jeton signé, même durée de vie que le réglage' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '072i1', platforms: ['server'], text: 'Confidentialité inventaire par rôle côté serveur : magasinier/opérateur ne reçoivent plus prix ni coûts (liste, scan, dashboard, contexte Agent) ; rapports comptables réservés owner/admin' },
          { id: '072i2', platforms: ['web'], text: 'Modale « Appareils connectés » : nom d’appareil lisible (Atlas Android · modèle, Chrome · Windows…) et ville/pays selon l’IP au lieu de l’empreinte hexadécimale' },
          { id: '072i3', platforms: ['web'], text: 'Bannière cookies : fini le plein écran — petite carte flottante en bas au centre, au-dessus de tout, non bloquante ; absente de /download, /whats-new et /about qui ne posent aucun cookie' },
          { id: '072i4', platforms: ['server'], text: 'Tous les QR codes générés (reçus, factures, rapports, aperçus) portent le nouveau logo Atlas au centre, sur pastille blanche' },
          { id: '072i5', platforms: ['web'], text: 'Rapports détaillés ouverts depuis le rapport combiné : bouton « ← Retour aux rapports combinés » en haut, jamais imprimé ; page À propos : profil créateur Etherealmber avec tous ses dépôts publics, plus seulement la vitrine' },
          { id: '072i6', platforms: ['server'], text: 'Automatisation du dépôt : branches fusionnées supprimées automatiquement, README et page Sécurité resynchronisés à chaque version — politique de support : seule la mineure courante est supportée, la mineure précédente passe en fin de support dès le changement de mineure' },
          { id: '072i7', platforms: ['server', 'web'], text: 'Vérification de connexion : le mail OTP et la page /verify suivent le thème sombre zinc du serveur (cartes, code, boutons), marque « Atlas » seule au lieu du doublon « Atlas Commerce », pied de page © 2026 Etherealmber · MIT' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '072f1', platforms: ['server'], text: 'Déploiements Cloudflare fiabilisés : test de boot du worker en CI — toute référence manquante dans un module de routes casse désormais la CI, plus le deploy prod' },
          { id: '072f2', platforms: ['web'], text: 'Sécurité dépendances : undici 7.30.1 (override, 0 vulnérabilité npm audit) ; éditeur d’image sanitisé (data-URL image strictes uniquement, CodeQL)' },
          { id: '072f3', platforms: ['server'], text: 'Mail OTP : bloc « Compte / Adresse IP / Appareil / Empreinte » reconstruit en tableau email-safe — les clients mail cassaient la mise en page flex et collaient libellés et valeurs (« Compteadmin »)' },
        ],
      },
    ],
  },
  {
    version: '0.7.1-beta',
    date: '28 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '071a1', platforms: ['web'], text: 'Pages publiques À propos et Télécharger : /about et /download se lisent sans compte, dans une mise en page dédiée sans barre du haut ; /download lit le manifeste latest.json du CDN et propose l’APK officielle en nouvel onglet' },
          { id: '071a2', platforms: ['web'], text: 'Pastille flottante animée (rebond doux + point pulsant, respect de prefers-reduced-motion) qui attire l’attention vers le téléchargement de l’app Android ; un clic ouvre /download en nouvel onglet et la masque, un × la masque aussi' },
          { id: '071a3', platforms: ['server'], text: 'Signalements et crashs : les issues GitHub partent désormais dans le dépôt Android (atlas-commerce-android) ; un ancien réglage pointant le dépôt web est migré à la lecture, un choix explicite du propriétaire reste respecté' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '071i1', platforms: ['web'], text: 'Login figé sur la surface sombre avec le lockup blanc 64 px au-dessus de « Bon retour », colonne formulaire centrée hors panneau QR, pied de page deux rangs (liens puis meta) et texte autorempli toujours lisible' },
          { id: '071i2', platforms: ['web', 'server'], text: 'Modale « Appareils connectés » redesignée : rangées cartes avec icône téléphone/PC, chip « actuel », bouton Révoquer style danger, fermeture visible et fonctionnelle ; après révocation l’appareil devra saisir un code OTP à sa prochaine connexion' },
          { id: '071i3', platforms: ['server'], text: 'E-mails OTP à la charte Atlas : le logo officiel remplace l’emoji, terracotta et saffron de la marque au lieu des oranges génériques, fonds papier et neutres zinc alignés sur les documents PDF' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '071f1', platforms: ['web'], text: 'Popup « Aperçu PDF » réparé : l’aperçu et le choix du QR « situation client » s’ouvrent désormais dans un portail React sur document.body — plus de fenêtre coupée en haut quand un ancêtre est transformé ou flouté, centrage garanti et fermeture au clic extérieure' },
        ],
      },
    ],
  },
  {
    version: '0.7.0-beta',
    date: '27 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '070a1', platforms: ['android', 'server', 'web'], text: 'Atlas Agent trilingue : l’assistant répond dans la langue choisie dans l’app Android (français, anglais, arabe) — le champ response_language est accepté et appliqué côté serveur sur les deux voies (/api/assist/chat et le flux SSE), quick prompts compris ; le prompt système impose la langue sélectionnée au lieu de revenir au français' },
          { id: '070a2', platforms: ['android', 'server', 'web'], text: 'Version minimale Android pilotée depuis le web : Settings → panneau Mise à jour app active un plancher de versionCode ; les builds sous le plancher reçoivent 426 APP_UPDATE_REQUIRED avec version et URL APK, les publications CI ne réinitialisent jamais le plancher, et le check public expose minimumVersionRequired' },
          { id: '070a3', platforms: ['web'], text: 'Page Nouveautés en lecture libre : /whats-new s’ouvre sans compte, dans une mise en page dédiée sans barre du haut ni accès au reste de l’application ; les utilisateurs connectés conservent l’expérience complète avec filtres' },
          { id: '070a4', platforms: ['android'], text: 'Android — arabe de bout en bout : direction RTL appliquée à toute l’app, flèches directionnelles et hero de connexion mirroirés, copies Agent en arabe et anglais ; chaque envoi Agent (quick prompts, pièces jointes, confirmation sensible, fallback stream) porte la langue choisie via response_language' },
          { id: '070a5', platforms: ['desktop'], text: 'Desktop — expérience native : texte non sélectionnable, mises à jour uniquement via GitHub Releases, choix du serveur au premier lancement ; ce journal suit les mêmes dates et conditions que le web et l’Android' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '070i1', platforms: ['server', 'android', 'web'], text: 'Messages d’erreur du serveur traduits : les erreurs stables renvoyées à l’app (authentification, message vide, Agent non configuré ou en échec, mise à jour obligatoire, jeton de notification) existent en français, anglais et arabe, choisies selon l’en-tête Accept-Language ; les codes machine (UNAUTHORIZED, APP_UPDATE_REQUIRED, DEVICE_TOKEN_STORE_ERROR…) restent inchangés' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '070f1', platforms: ['android', 'server'], text: 'Notifications Android réparées : le module FCM contenait des déclarations avalées par un commentaire (ReferenceError « _localSchemaOnce is not defined » en production) ; la route d’enregistrement du jeton crée la table, upserte le token authentifié et renvoie un code stable DEVICE_TOKEN_STORE_ERROR sans jamais exposer de stack' },
          { id: '070f2', platforms: ['android', 'server'], text: 'Passkeys Android : plusieurs empreintes de certificat acceptées et publiées dans assetlinks (release + debug), et excludeCredentials ne propose plus que des credentials ayant une clé publique — sans supprimer aucune ligne ni affaiblir aucun contrôle' },
          { id: '070f3', platforms: ['web', 'android'], text: 'Lot terrain 0.7 : login par téléphone avec OTP, captcha anti-robot, aperçu de reçu PDF avec données réelles et QR fonctionnel (tap → situation du QR), nouveau logo et splash animé, dock mobile en bas, corrections complètes des thèmes sombre et clair' },
        ],
      },
    ],
  },
  {
    version: '0.6.6-beta',
    date: '26 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '066a1', platforms: ['web'], text: 'Logo enfin visible et net en thème sombre : un ancien carreau clair (#f1f5f9) imposé sous l’icône de la sidebar — et le tile blanc encadré de la page À propos — masquaient l’artwork blanc (logo « invisible » posé sur un carré clair) ; les carreaux sont supprimés pour les images de marque, la priorité CSS est renforcée contre les règles héritées, et le README GitHub bascule sur le lockup blanc en mode sombre (picture + prefers-color-scheme)' },
        ],
      },
    ],
  },
  {
    version: '0.6.5-beta',
    date: '25 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '065a1', platforms: ['web'], text: 'Nouvelle identité visuelle appliquée partout : les deux logos officiels (lockup noir sur fond clair, lockup blanc sur fond sombre) remplacent l’ancien logo vectoriel — sidebar, barre du haut Paramètres, écran de connexion (lockup complet avec le wordmark), page À propos et centres des QR codes ; la bascule clair/sombre se fait automatiquement par paire d’images PNG transparentes (fonds retirés au pixel près, icône découpée du lockup)' },
          { id: '065a2', platforms: ['web'], text: 'Favicons et PWA régénérés depuis le nouveau logo : favicon 16/32 px + .ico + variantes sombres servies selon prefers-color-scheme, apple-touch 180 px, icônes de manifest 192/512 (png + webp), image de partage 1200×630 ; les anciens fichiers vectoriels (logo.svg, logo-mark.svg, favicon.svg, og-image.svg) sont retirés et le manifest mis à jour' },
        ],
      },
    ],
  },
  {
    version: '0.6.4-beta',
    date: '24 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '064a1', platforms: ['web', 'server'], text: 'Sécurité — journal de trésorerie verrouillé : créer une écriture de solde (et l’import en masse) est désormais strictement réservé au propriétaire et aux administrateurs — avant cet audit, n’importe quel compte connecté (magasinier, utilisateur simple…) pouvait insérer des écritures, y compris des apports/prélèvements propriétaire ; chaque écriture est maintenant journalisée (qui, quoi, quand) et des tests d’autorisation + de validation verrouillent le contrat (403 OWNER_ONLY, 422 VALIDATION)' },
          { id: '064a2', platforms: ['web', 'server'], text: 'Sécurité — Atlas Agent : les comptes suspendus et les quotas de jetons épuisés sont désormais refusés côté SERVEUR avant tout appel à l’IA (le contrôle ne reposait que sur l’application web — un client modifié pouvait le contourner)' },
        ],
      },
      {
        kind: 'features',
        items: [
          { id: '064a3', platforms: ['web', 'server'], text: 'Nouvelle API finance `GET /api/admin/finance/period?period=AAAA-MM` (propriétaire/admin) : ventilations espèces/banque des entrées et sorties calculées serveur avec les MÊMES règles canoniques et le même fuseau que le relevé (mois ouvert arrêté à aujourd’hui, lignes miroir et « Avoir » exclus), apports et prélèvements propriétaire séparés, totaux par catégorie de dépenses, et bloc relevé intégré revérifié à chaque appel — impossible d’être en désaccord avec le relevé ; les paiements sans moyen enregistré (salaires) sont déclarés « non enregistrés », jamais devinés' },
          { id: '064a4', platforms: ['web', 'server'], text: 'Atlas Agent lit vraiment les PDF et fichiers texte joints : extraction serveur bornée et validée par signature binaire (≤2 documents, ≤2 Mo, ≤30 pages PDF, extrait plafonné à 12 000 caractères, types MIME sur liste blanche) — un PDF scanné sans texte est annoncé tel quel au modèle avec interdiction d’inventer ; un document refusé rejette toute la requête avec un code stable' },
          { id: '064a5', platforms: ['web', 'server'], text: 'Atlas Agent en streaming SSE : `POST /api/assist/chat/stream` diffuse la réponse jeton par jeton (event: token / done / error) avec les mêmes verrous (session, suspension, quota, documents) ; le quota est débité sur la consommation RÉELLE rapportée par le dernier chunk — un tour streamé coûte exactement ce qu’un tour classique coûte' },
        ],
      },
    ],
  },
  {
    version: '0.6.3-beta',
    date: '23 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '063a1', platforms: ['web'], text: 'Barre Rapports PDF : le champ mois n’est plus jamais vide — pour « Ce mois », « 3 mois » et toute période relative, il affiche le mois d’ancrage de la période (ex. 10/2026) avec une info-bulle explicative ; choisir un mois dedans bascule toujours la période sur ce mois précis ; le libellé « Période : … » reste affiché à côté' },
        ],
      },
      {
        kind: 'features',
        items: [
          { id: '063a2', platforms: ['desktop'], text: 'docs/desktop-design-prompt.md : le PROMPT MAÎTRE pour construire l’app desktop en parité visuelle stricte avec le web et l’Android — toutes les valeurs exactes (hex clair/sombre, rayons, typo DM Sans/Spline Sans Mono, densités, hauteurs, motion cubic-bezier(0.2,0,0,1), règles sombres, assistants, checklist par écran, protocole de vérification) extraites des deux repos avec citations de fichiers : l’IA n’a plus rien à prédire' },
        ],
      },
    ],
  },
  {
    version: '0.6.2-beta',
    date: '22 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '062a1', platforms: ['web', 'server'], text: 'Rapports sur un mois précis : /api/reports/combined et ses sections acceptent désormais une période AAAA-MM strictement validée (année 1970–2100, mois 01–12 — toute valeur invalide retombe sur le mois en cours, jamais de dates cassées) en plus des périodes relatives (ce mois, 3/6/9/12 mois, 2–4 ans, année civile, personnalisé) ; sélecteur de mois dans Solde (input type=month) à côté des périodes rapides' },
          { id: '062a2', platforms: ['web', 'server'], text: 'Périodes ancrées sur le fuseau finance de l’entreprise (company_settings.finance_timezone, défaut Africa/Casablanca) : le mois en cours s’arrête à AUJOURD’HUI dans ce fuseau (plus le jour UTC du serveur), les mois passés utilisent le mois complet (février bissextile inclus), le mois futur est borné proprement ; la période choisie est propagée à toutes les sections et à tous les liens du rapport combiné (rt + période normalisée — l’entrée brute n’est jamais recopiée)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '062a3', platforms: ['web', 'server'], text: 'Sécurité rapports inchangée et renforcée : les liens profonds gardent le ticket HMAC rt courte durée (30 min) — jamais de JWT de session accepté ni exposé dans les liens (le paramètre token est supprimé défensivement) ; la synthèse Solde du rapport combiné est maintenant bornée par la période sélectionnée ; logique extraite dans worker/lib/report-period.ts (pure, testable) — 17 nouveaux tests (mois valides/invalides, bornes de fuseau Tokyo/UTC/Casablanca sans offset figé, mois courant partiel, mois historiques bissextiles, propagation rt+période) — vitest 112/112' },
        ],
      },
    ],
  },
  {
    version: '0.6.1-beta',
    date: '21 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '0510a1', platforms: ['android', 'server'], text: 'Passkeys Android : le vérificateur accepte désormais LES DEUX formats d’origine natifs documentés — android:apk-key-hash-sha256: (émis par Credential Manager) ET le préfixe historique android:apk-key-hash: (base64 du SHA-1 du certificat, documenté par la stack FIDO2 d’Android) via WEBAUTHN_ANDROID_CERT_SHA1 optionnel ; la comparaison est octet par octet après décodage tolérant (base64 standard ou url-safe, avec ou sans remplissage) — plus aucun échec WEBAUTHN_BAD_ORIGIN dû à une simple différence d’encodage ou de préfixe' },
          { id: '0510a2', platforms: ['android', 'server'], text: 'GET /api/auth/webauthn/status expose data.android.origin_legacy à côté de data.android.origin : l’app et l’APK comparent exactement ce que le backend accepte avant d’afficher les passkeys ; 4 nouveaux tests (dérivation SHA-1, acceptation multi-encodages, rejet sans empreinte SHA-1, connexion native legacy) — vitest 95/95' },
        ],
      },
    ],
  },
  {
    version: '0.5.9-beta',
    date: '20 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '059a1', platforms: ['web', 'server'], text: 'Crash reporting automatique : les plantages de l’application (erreurs globales, promesses rejetées, crashs d’écrans React) sont capturés, assainis (secrets et tokens retirés, adresse IP hachée), dédupliqués par empreinte — un bug = une seule issue — puis envoyés directement dans les issues GitHub du projet ; sans token configuré, tout est gardé en file et part automatiquement dès sa configuration (cron quotidien inclus), aucun rapport n’est perdu' },
          { id: '059a2', platforms: ['web', 'server'], text: 'Signalement utilisateur : À propos → « Signaler un problème » — bug, idée ou question, avec contact facultatif ; chaque message devient une issue GitHub avec sa référence (R-…), sans que l’utilisateur ait besoin d’un compte GitHub' },
          { id: '059a3', platforms: ['web', 'server'], text: 'Panneau propriétaire Paramètres → Intégrations → « Rapports & crashs → GitHub » : collez un token fine-grained (Issues en lecture/écriture — gratuit, github.com/settings/personal-access-tokens/new), il est validé contre GitHub avant stockage et n’est jamais renvoyé ; dépôt cible modifiable, file d’attente visible, renvoi manuel, crashs et signalements récents avec liens vers les issues' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '059a4', platforms: ['server'], text: 'Documentation reprise de zéro : SETUP.md — installation complète du premier départ (comptes gratuits, base de données D1, cache KV, stockage R2, chaque secret avec le lien de son fournisseur : Groq, Google AI Studio, Resend, Turnstile, Firebase, GitHub — déploiement 100 % navigateur sans CLI via Workers Builds, domaine personnalisé, e-mail OTP, vérification, passkeys et app Android) ; docs/reports-github.md (confidentialité, déduplication, endpoints) ; README corrigé (Capacitor supprimé, index à jour) ; nettoyage de 7 fichiers d’état obsolètes' },
        ],
      },
    ],
  },
  {
    version: '0.5.8-beta',
    date: '19 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '058a1', platforms: ['android', 'server'], text: 'Passkeys Android (Credential Manager) : le vérificateur accepte désormais l’origine native android:apk-key-hash-sha256 dérivée de l’empreinte SHA-256 du certificat de signature Play configuré côté serveur, ainsi que l’origine web en mode cross-origin quand le paquet Android signé correspond — sans configuration Android, tout reste strictement web (origine exacte, crossOrigin rejeté)' },
          { id: '058a2', platforms: ['android', 'server'], text: 'WEBAUTHN_ANDROID_PACKAGE préconfiguré (ma.etherealmber.atlascommerce) ; GET /api/auth/webauthn/status expose data.android.origin — la valeur exacte acceptée par le backend, à comparer avec celle produite par l’APK signé Play ; /.well-known/assetlinks.json s’active automatiquement dès que l’empreinte du certificat est renseignée (Play Console → Setup → App integrity)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '058a3', platforms: ['android', 'server'], text: '6 nouveaux tests d’intégration Android (dérivation de l’origine apk-key-hash, enregistrement/connexion natifs acceptés, paquet inconnu ou certificat non configuré rejetés, matrice cross-origin) — suite vitest 78/78 ; docs/webauthn.md §4a : matrice complète des origines acceptées' },
        ],
      },
    ],
  },
  {
    version: '0.5.7-beta',
    date: '18 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '057a1', platforms: ['server'], text: 'Passkeys (WebAuthn) : vérification cryptographique complète côté serveur — challenge aléatoire à usage unique (atomique, 5 minutes, lié au compte, au RP et à l’origine), type webauthn.create/get vérifié, origine exacte autorisée, hash RP ID, flags présence/verification utilisateur, attestation « none » uniquement, clé publique ES256 extraite de l’objet d’attestation et stockée, signature vérifiée sur authData + hash clientData, handle utilisateur obligatoirement égal au compte (un passkey d’un autre compte est rejeté), compteurs anti-rejeu avec règle des passkeys synchronisés, doublons refusés, inscription liée à la session active' },
          { id: '057a2', platforms: ['web', 'android', 'server'], text: 'Capacité passkeys exposée aux clients : GET /api/auth/webauthn/status — l’app et l’APK n’affichent les passkeys QUE si le serveur les a activées de façon sécurisée (enabled, rp, origines, user_verification, ES256, état Android) ; Android Credential Manager : /.well-known/assetlinks.json servi automatiquement dès que le package et l’empreinte SHA-256 de signature Play sont configurés (docs/webauthn.md §4)' },
          { id: '057a3', platforms: ['web', 'server'], text: 'Audit miroir automatique (finance) : chaque réponse mensuelle et chaque relevé embarque mirror_audit — lignes miroir exclues comparées aux tables bill_payments/employee_payments avec drapeau consistent ; la vérification du correctif 6 000 MAD tourne toute seule en production, à chaque requête, sans CLI ni PC' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '057a4', platforms: ['server'], text: 'Sécurité passkeys : avant cette version, les routes WebAuthn faisaient confiance aux champs soumis par le client (aucune vérification de signature, clé publique jamais stockée, token émis après simple consommation du challenge + lookup de l’identifiant, challenges liés à une empreinte fournie par le client et consommation non atomique) — vecteur de prise de compte ; désormais chaque succès exige la vérification complète, les anciennes lignes sans clé publique sont inertes, et tout échec de connexion renvoie un code générique unique (401 WEBAUTHN_VERIFY_FAILED) qui rend l’énumération de comptes impossible' },
          { id: '057a5', platforms: ['server'], text: 'Passkeys volontairement DÉSACTIVÉES en production (WEBAUTHN_ENABLED=false — les 4 routes répondent 503 WEBAUTHN_DISABLED) jusqu’à validation de la checklist de déploiement docs/webauthn.md §5 ; 27 nouveaux tests WebAuthn (signatures ES256 réelles, fixtures CBOR, replay, origines, flags, compteurs, politiques) — suite vitest 72/72' },
        ],
      },
    ],
  },
  {
    version: '0.5.6-beta',
    date: '17 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '056a1', platforms: ['web', 'server'], text: 'Relevé mensuel de trésorerie côté serveur : GET /api/admin/finance/statement (owner/admin) — solde d’ouverture, mouvements chronologiques (encaissements, remboursements, dépenses, paie, fournisseurs) avec solde courant ligne à ligne, références assainies (numéros de documents, jamais de données personnelles), totaux, pagination, statut mois ouvert/clos et contrôle d’exactitude ouvrant + crédits − débits = clôturant ; le relevé, le résumé mensuel et le PDF partagent désormais UN SEUL calcul canonique' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '056a2', platforms: ['web', 'server'], text: 'Finance : fin du double comptage des paiements fournisseur et des salaires — chaque paiement écrivait une ligne miroir dans les dépenses (journal de Solde) que le calcul mensuel re-soustrayait : un règlement de 6 000 MAD apparaissait comme dépense fantôme ET trou de 6 000 MAD dans la clôture ; les avoirs (« Avoir … ») gonflaient aussi les encaissements ; correction rétroactive de toutes les périodes, sans supprimer aucune donnée, avec tests de régression (doublons visibles, annulations, frontières de fuseau, isolation société)' },
          { id: '056a3', platforms: ['web', 'server'], text: 'Finance : les paiements facture/achat datés par défaut au jour LOCAL du tenant (Africa/Casablanca) au lieu du jour UTC — un encaissement saisi juste après minuit tombait dans le mois précédent' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '056a4', platforms: ['server'], text: 'Chargement plus rapide : Smart Placement (le worker tourne près de sa base D1 — chaque requête API économise un aller-retour inter-régional) + en-têtes de cache immuables pour les bundles hashés (public/_headers) ; le cache edge des avatars est réactivable sans risque (toutes les réponses JSON privées restent no-store)' },
        ],
      },
    ],
  },
  {
    version: '0.5.5-beta',
    date: '15 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '055a1', platforms: ['web'], text: 'Le téléphone devient le jumeau de l’app Android : même barre du haut (titre de l’onglet, sous-titre nom · rôle, menu rapide rond à chevron avec badge notifications, avatar qui ouvre le profil), même barre d’onglets à 5 places (Accueil, Produits, Scan, Vente avec badge panier — masquée pour les rôles sans caisse, Agent) et même accueil que l’APK : héros dégradé sombre adapté au rôle (ventes du jour ou pilotage catalogue & stock), boutons Nouvelle vente / Scanner + Produits, carte Info Box avec puce Ouvrir, tuiles de statistiques à icônes et tons (produits, ventes, stock faible, envois en attente), alerte stock dédiée, raccourcis entrepôt/achats/devis — palette zinc-papier-safran, coins 8 à 24 px, typographie et espacements compacts repris à l’identique du Material 3 natif' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '051d17', platforms: ['web'], text: 'Le téléphone retrouve son VRAI espace optimisé : l’app terrain /m (scan d’abord, catalogue hors-ligne, barre d’onglets) se relance automatiquement sur les petits écrans, l’APK native et ?mode=phone — le PC garde l’ERP complet. Passé confort tactile : cibles 44px+, anti-zoom iOS sur les champs, plus de texte sélectionnable sur les boutons, ripple matériau au toucher (React Bits), chiffres animés (CountUp) et loupe Lens sur les images. Qualité : oxlint branche le radar à bugs (0 erreur, 23 vrais défauts corrigés) dans la CI' },
          { id: '051d18', platforms: ['web', 'server'], text: 'Finance côté serveur, sûre par rôle : rapport mensuel de trésorerie calculé par le worker (soldes ouverture/clôture, encaissements, dépenses, remboursements, créances clients et dettes fournisseurs échues/en retard, paie due) réservé owner/admin, PDF mensuel généré à la demande (jamais stocké ni devinable, téléchargement journalisé), échéancier de paie paginé sans données personnelles, et rappels programmés non spammeurs (jours 1/2/3 : rapport prêt puis seulement les changements ; factures clients et fournisseurs échues, paie due, paiement client enregistré) avec anti-doublon durable en base, revérification du rôle à l’envoi, retries avec backoff et montants masqués sur l’écran de verrouillage si réglé' },
          { id: '055a2', platforms: ['web'], text: 'Historique des nouveautés réorganisé : l’énorme liste de la 0.5.1 est répartie en versions lisibles (0.5.1 allégée, puis 0.5.2 Avatars & agent, 0.5.3 Base de données, 0.5.4 Sécurité & CI) — aucun contenu supprimé, mêmes identifiants ; la version courante passe à 0.5.5-beta' },
          { id: '055a5', platforms: ['web', 'server'], text: 'Paie : chaque employé peut voir SA date de paie — nouveau point API GET /api/me/payroll strictement limité à sa propre fiche (liaison par identifiant de connexion, champ « Compte lié » sur la fiche employé, configurable par l’admin) ; jamais les données des autres, réponse claire si aucune fiche n’est liée' },
          { id: '055a6', platforms: ['android', 'server'], text: 'Push Android : le pont FCM complet est livré (correctif prêt à appliquer + guide pas à pas dans docs/) — SDK Firebase Messaging, service de réception, canal « Assistant & notifications serveur », enregistrement automatique du jeton d’appareil à chaque connexion pour que les notifications du serveur (agent, paie, stock) atteignent enfin l’APK' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '055a3', platforms: ['web'], text: 'Agent Atlas : cliquer/taper sur une image jointe l’ouvre désormais en plein écran — la visionneuse n’était plus piégée dans le panneau de l’agent (correctif portail), sur les vignettes envoyées comme sur les puces en cours de composition' },
          { id: '055a4', platforms: ['web'], text: 'Agent Atlas : les images jointes survivent au rafraîchissement de la page — photos recompressées (≤1280 px) puis enregistrées avec la conversation (local + serveur), pièces jointes non envoyées restaurées après rechargement, repli propre si le quota de stockage est atteint' },
          { id: '055a7', platforms: ['web'], text: 'Nouveau produit : la photo ajoutée dans l’assistant se modifie avant création — bouton ✎ sur chaque photo déposée (outil de recadrage complet, le même qu’en modification), la version recadrée est celle envoyée au catalogue' },
        ],
      },
    ],
  },
  {
    version: '0.5.4-beta',
    date: '13 octobre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '051d7', platforms: ['web'], text: 'Assistants : plus aucune pastille d’étapes en haut (le chip « Étape X/Y » du pied suffit), plus de défilement même sur fenêtre étroite (2 colonnes gardées dans les modales) ; vente rapide sans double champ code-barres/SKU ; zone OCR compacte sans bouton « Choose File » natif (glisser-déposer réel) ; mode sombre : cartes Solde/fournisseurs, bouton « Arrêter » de l’agent, pastilles « Aller à », indicateur Réflexion et toggle mot de passe enfin thémés, et aucun bouton ne devient blanc au tap/focus' },
          { id: '051d8', platforms: ['server'], text: 'Trois gardes CI sur chaque pull request : API (TypeScript worker vs baseline + dry-run wrangler, rien n’est déployé par la CI), frontend (build Vite + sanity du bundle + TypeScript src vs baseline), et thèmes/CSS (structure des feuilles de style, dark-force.css dernier import, aucune nouvelle couleur blanche en mode sombre) — un PR rouge ne peut plus atteindre la production' },
          { id: '051d10', platforms: ['android', 'server'], text: 'Pipeline de release Android sans aucun upload manuel : GitHub Actions POSTe l’APK signé sur /api/admin/android-release (Bearer), le worker le streamme vers R2/CDN1 (version immuable + latest.apk + latest.json no-cache), l’app lit /api/app/android-update et les pings HEAD /app-updates/* répondent via bucket.head() — tests vitest inclus et lancés par la CI' },
          { id: '051d11', platforms: ['server'], text: 'Automatisation GitHub : patrouille de sécurité quotidienne qui « tente de pirater » le site (SQLi, XSS, traversal, Log4Shell, accès admin non authentifié), compte les intrusions réelles bloquées par le WAF et ouvre un ticket avec les correctifs possibles ; triage automatique des tickets (plainte, bug, sécurité, idée) avec accusé de réception ; formulaires de tickets structurés ; et auto-merge des PR uniquement quand TOUS les contrôles CI sont verts' },
          { id: '051d15', platforms: ['server'], text: 'Entretien automatique du dépôt : les branches fusionnées ou dont la PR est fermée sont supprimées (à la fermeture + balayage hebdomadaire, jamais une branche avec PR ouverte ni non fusionnée), et la patrouille peut purger elle-même le cache Cloudflare et nommer la règle pare-feu qui la bloque si un jeton CF_API_TOKEN est fourni' },
          { id: '051d16', platforms: ['server'], text: 'Nouveau design des e-mails OTP (maquette fournie adoptée telle quelle : en-tête logo, tag saumon, grand titre avec italique, boîte de code, bouton orange pleine largeur, pied noir avec réseaux sociaux) et vérification en UN tap : le bouton ouvre /verify qui transmet le code tout seul au worker (lien signé, usage unique), détecte la PWA installée ou l’app Android native et lui passe la main directement — plus aucun code à recopier' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '051d12', platforms: ['server'], text: 'Premier rapport de la patrouille corrigé à la racine : /api/health et /api/canary redeviennent publics (la sonde pré-login du sélecteur de serveur Android répondait 401), et la patrouille v2 distingue le WAF du worker de l’edge Cloudflare, lit les corps JSON (un 200 « success:false » est bien un refus), détecte les fuites de cache edge sur /api/* et ne se fait plus piéger par ses propres en-têtes' },
          { id: '051d13', platforms: ['server'], text: 'Anti-fuite de cache edge : toutes les réponses /api non explicitement publiques renvoient désormais Cache-Control no-store + CDN-Cache-Control no-store — plus aucun listing authentifié ne peut être rejoué anonymement par le cache Cloudflare (finding réel de la patrouille) ; la patrouille v3 reconnaît HIT/STALE/EXPIRED/REVALIDATED et identifie la couche exacte (worker, edge, cache) dans chaque finding' },
          { id: '051d14', platforms: ['server'], text: 'La patrouille a trouvé une vraie faille critique et elle est corrigée : un appelant SANS jeton (ou avec un jeton forgé en base64) était traité comme « owner » sur 58 routes API enregistrées avant le middleware d’authentification (admin/users, admin/config, admin/audit, r2/images, db-migrate…). Le middleware d’authentification est désormais enregistré AVANT toutes les routes (vérification HMAC + IP/appareil pour tout le monde), l’anonyme reste anonyme, le flux de connexion QR continue de fonctionner, et la patrouille rejoue l’attaque (jeton forgé) à chaque passage pour garantir que la porte reste fermée' },
        ],
      },
    ],
  },
  {
    version: '0.5.3-beta',
    date: '11 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '051d4', platforms: ['server'], text: 'Corruption D1 (« database disk image is malformed » / SQLITE_CORRUPT) reconnue : message clair « base corrompue, restauration Cloudflare requise » (code DB_CORRUPT) au lieu d’un « Erreur interne » générique sur tout le site' },
          { id: '051d5', platforms: ['server'], text: 'Auto-réparation de l’index de recherche produit (FTS5) : en cas de corruption (SQLITE_CORRUPT_VTAB), l’index est reconstruit depuis products — ou recréé et re-rempli — sans aucune perte de données, puis l’action n’a qu’à être réessayée ; bouton de reconstruction manuel réservé owner/admin' },
          { id: '051d6', platforms: ['server'], text: 'Réplication de lecture D1 (Sessions API) branchée automatiquement : chaque requête ouvre une session D1 (cookie de bookmark pour relire ses propres écritures), les lectures peuvent être servies par la réplique la plus proche — et une sonde d’intégrité FTS tourne en tâche de fond (≤1/5 min) pour réparer sans aucune action manuelle' },
          { id: '051d9', platforms: ['server'], text: 'E-mails entrants : le worker accepte de nouveau les événements Email Routing (export email()) au lieu de crasher « Handler does not export an email() function » — réponse, bounce ou OTP revenu par une règle catch-all : une ligne de journal puis consommation silencieuse ; l’envoi OTP passe toujours par Resend en premier' },
        ],
      },
    ],
  },
  {
    version: '0.5.2-beta',
    date: '9 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '052a1', platforms: ['web'], text: 'Atlas Agent lit chaque fichier DÈS l’envoi (images en vision, extraits texte inclus dans le prompt) ; dire « lis ça » sans joindre de fichier reprend automatiquement le dernier fichier envoyé' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '053b1', platforms: ['web'], text: 'Avatar instantané : cache blob en mémoire partagé par toute l’app (un seul téléchargement par session), cache Durable Object + cache edge côté worker, et préchargement dès l’ouverture de session — fini l’attente sur le cercle vide' },
          { id: '053b2', platforms: ['web'], text: 'Avant l’arrivée de la photo, le monogramme/initials s’affiche immédiatement (plus jamais de cadre vide)' },
          { id: '053b3', platforms: ['web'], text: 'Avatars recadrés encodés en WebP (~3× plus léger que JPEG) : upload et chargement plus rapides' },
          { id: '054b1', platforms: ['web'], text: 'Aucun assistant ne défile : l’étape « Prix & stock » du produit est scindée (étape dédiée « Remises volume ») — audit complet de tous les wizards (Devis, Employés, Clients, Factures, Vente rapide, Achats, Fournisseurs, Solde, Remboursement) : chaque étape statique tient à l’écran, seules les listes de lignes dynamiques défilent sous le pied fixe' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '052c4', platforms: ['web'], text: 'Contours d’images thématisés (fini le liseré noir en mode clair / blanc en mode sombre) + fond neutre sous les PNG transparents' },
          { id: '052c5', platforms: ['web'], text: 'Historique des versions entièrement renuméroté en 0.x : l’ancien cycle 1.x devient 0.0.1 → 0.4.4 (première version = 0.0.1), plus aucune étiquette 1.x ni doublon' },
          { id: '055c1', platforms: ['server'], text: '« Erreur interne » sur l’enregistrement produit : la colonne updated_at est désormais gardée comme les autres, le contrôle de doublon ne peut plus faire échouer la sauvegarde, et la cause exacte est journalisée côté serveur ; le service worker passe en v11 — les vieux caches production (qui resservaient l’ancien JS) sont purgés' },
          { id: '055c2', platforms: ['web', 'server'], text: 'Appareils connectés : chaque appareil actif du compte (PC, téléphone) s’enregistre automatiquement et apparaît dans la popup, appareil courant marqué « current »' },
          { id: '055c3', platforms: ['web'], text: 'Agent : un message avec pièces jointes n’affiche plus aucun texte parasite (« Voir les pièces jointes [Pièces jointes: …] ») — pastilles propres avec le nom du fichier, dans les deux thèmes' },
          { id: '055c4', platforms: ['web'], text: 'Mode sombre : boutons copier/× des messages et ✎/✕ des pièces jointes enfin visibles (encre constante, survols thémés)' },
          { id: '051d1', platforms: ['web'], text: 'Nouveau produit : la zone d’upload des photos existe dès l’étape Photos de l’assistant de création (glisser-déposer ou parcourir, aperçus avec suppression) — les images choisies partent automatiquement juste après la création' },
          { id: '051d2', platforms: ['web'], text: 'Photo de profil visible immédiatement après un rafraîchissement : topbar, menu utilisateur et réglages se mettent à jour dès que le profil arrive, sans aucun clic' },
          { id: '051d3', platforms: ['web', 'server'], text: 'Facture : si la déduction de stock échoue (erreur base de données), la facture est annulée et l’erreur réelle s’affiche dans la zone prévue — plus jamais de stock faussé en silence' },
        ],
      },
    ],
  },
  {
    version: '0.5.1-beta',
    date: '7 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '0411a1', platforms: ['web'], text: 'Glisser-déposer réel des photos produit : déposez vos images directement sur l’étape Photos (zone en pointillés pleine largeur, surbrillance cuivre pendant le glisser), ou cliquez pour parcourir' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '0411b1', platforms: ['web'], text: 'Assistant produit allégé : l’étape « Variantes & photos » est séparée en deux étapes dédiées (Étape 3 Variantes · Étape 4 Photos) — moins de contenu d’un coup, moins de défilement' },
          { id: '0411b2', platforms: ['web'], text: 'Pied d’assistant réellement fixe dans toutes les fenêtres : les boutons ne bougent plus et ne recouvrent jamais le contenu — le corps de l’étape défile à l’intérieur, la barre reste en bas' },
          { id: '0411b3', platforms: ['web'], text: 'L’assistant repart toujours à l’étape 1 à chaque ouverture (nouveau produit, modification, pré-remplissage scan/agent)' },
          { id: '0411b4', platforms: ['web'], text: 'Assistant produit en 5 étapes (Identité · Classement · Prix & stock · Variantes · Photos) : chaque étape tient à l’écran sans défilement' },
          { id: '0411c1', platforms: ['web'], text: 'Menu utilisateur du topbar ouvert dans un portail fixé sous le bouton : plus jamais rogné, masqué ou décalé — et la photo de profil s’affiche désormais dans son en-tête' },
          { id: '0411c2', platforms: ['web', 'server'], text: 'Avatar monogramme (SVG serveur) de nouveau visible partout : le filtre client n’acceptait que png/jpeg/webp — repli initiales si l’image échoue (topbar, sidebar, réglages)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '052c1', platforms: ['web', 'server'], text: 'Enregistrement produit : PUT/POST blindés contre les schémas D1 incomplets (garde PRAGMA sur chaque colonne) — plus de 500 « Erreur interne » en production' },
          { id: '052c2', platforms: ['web', 'server'], text: 'Photo de profil chargée via le proxy worker same-origin (/api/me/avatar) : le CORS de cdn1.afmarbre.com ne bloque plus l’avatar' },
          { id: '052c3', platforms: ['web'], text: 'Boutons ✎ / ✕ des pièces jointes de l’agent toujours visibles, thèmes clair et sombre' },
        ],
      },
    ],
  },
  {
    version: '0.5.0-beta',
    date: '5 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '0410c1', platforms: ['web'], text: '« Erreur interne — réessayez plus tard » sur l’enregistrement d’un produit : la migration optionnelle de la colonne des remises par quantité ne peut plus faire échouer la sauvegarde (PUT/POST produits blindés)' },
          { id: '0410c2', platforms: ['web', 'server'], text: 'Les erreurs de sauvegarde s’affichent désormais dans la zone prévue de la fenêtre (bannière rouge au-dessus des boutons) — assistant Produits, ajustement de stock, règlements (Facturation + Vente rapide), réception des factures d’achat et approbations Actions ne passent plus par un toast masqué' },
          { id: '0410c3', platforms: ['web', 'server'], text: 'Le journal réel de l’erreur reste côté serveur (logs Cloudflare) : plus aucun message SQL/interne exposé au client, mais la cause est tracée pour le débogage' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '0410b1', platforms: ['web'], text: 'Les notifications flottantes passent en haut de l’écran : elles ne se retrouvent plus jamais derrière les pieds de fenêtre ou les barres collantes' },
        ],
      },
    ],
  },
  {
    version: '0.4.9-beta',
    date: '3 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '049a1', platforms: ['server'], text: 'E-mails OTP via Resend (déjà configuré) : le code part vers la boîte de l’utilisateur (app_users.email), repli sur le binding Cloudflare — fini le « E-mail indisponible » en production' },
          { id: '049a2', platforms: ['server'], text: 'Nouveau gabarit d’e-mail OTP : en-tête charbon + monogramme cuivre, code espacé lisible, bloc appareil/IP, lien de vérification, avertissement de sécurité' },
          { id: '049a3', platforms: ['web'], text: 'Atlas Agent lit réellement les images jointes (vision Groq : qwen3.8-27b / llama-4-scout) — logos, factures et captures sont analysés, miniatures dans la bulle' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '049b1', platforms: ['web', 'server'], text: 'Envoi de l’e-mail de connexion en arrière-plan (waitUntil) et course 2,5 s sur les OTP de suppression : l’interface ne bloque plus jamais sur un fournisseur lent' },
          { id: '049b2', platforms: ['web', 'server'], text: 'Mémoire compacte de l’agent (6 derniers tours, ~250 jetons) + facturation des jetons réels côté serveur (prompt+completion) au lieu d’une estimation client' },
          { id: '049b3', platforms: ['web'], text: 'Numérotation revue : la vraie release sera 1.0.0 — le cycle bêta courant passe en 0.4.9, historique repris depuis la 0.0.1' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '049c1', platforms: ['server'], text: 'SÉCURITÉ : en production, les codes OTP ne sont plus jamais renvoyés dans les réponses API (otp vide + message propre) — le second facteur reste exclusivement postal' },
          { id: '049c2', platforms: ['web'], text: 'Boutons ✎ / ✕ des pièces jointes visibles dans les deux thèmes (SVG inline + exclus des chaînes CSS globales) ; titres d’images masqués partout' },
          { id: '049c3', platforms: ['web', 'server'], text: 'Note OTP (Confirmer / Annuler / champ) en palette zinc claire et sombre — plus de boutons noirs ni de fond crème' },
          { id: '049c4', platforms: ['server'], text: 'Pare-feu applicatif (WAF) sur /api/* : signatures SQLi, traversal, XSS et log4j bloquées (403) ; endpoint /api/canary pour la santé des déploiements' },
        ],
      },
    ],
  },
  {
    version: '0.4.8-beta',
    date: '1 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '048a1', platforms: ['web'], text: 'Heure exacte de rafraîchissement du quota affichée partout (messages, bannière, Paramètres) : minuit UTC chaque jour, lundi 00:00 UTC chaque semaine' },
          { id: '048a2', platforms: ['server'], text: 'Journal D1 de toute consommation de jetons (agent_usage_log) — survit aux remises à zéro, consultable par le propriétaire' },
          { id: '048a3', platforms: ['web', 'server'], text: 'Migration D1 → D1 depuis les Paramètres : copie company-stock-db → atlas-db par lots reprises, puis bascule réversible' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '048c1', platforms: ['web'], text: 'Modales toujours centrées verticalement + bouton de fermeture visible et thémé (appareils connectés inclus)' },
          { id: '048c2', platforms: ['web'], text: 'Cartes « Permissions Atlas Agent » lisibles en clair ET sombre ; doublon de titre supprimé' },
        ],
      },
    ],
  },
  {
    version: '0.4.7-beta',
    date: '29 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '047a1', platforms: ['server'], text: 'Quotas de jetons en Durable Object : persistants aux redéploiements, migration automatique des anciennes valeurs D1' },
          { id: '047a2', platforms: ['web', 'server'], text: 'Agent : markdown rendu, pièces jointes annotables (éditeur texte/dessin), stockage chiffré AES-GCM des conversations dans R2' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '047b1', platforms: ['web'], text: 'Popups guidés unifiés (wizard) : pied droit, chip d’étape compacte, erreurs inline, clic extérieur = annulation sans persister' },
        ],
      },
    ],
  },
  {
    version: '0.4.6-beta',
    date: '27 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '046a1', platforms: ['server'], text: 'Gouvernance de l’agent : 2FA, appareils connectés, suppressions gated par OTP, verrouillage anti-injection rétabli par admin' },
          { id: '046a2', platforms: ['web'], text: 'Plafonds de jetons jour/semaine (admin exempté et pilote)' },
        ],
      },
    ],
  },
  {
    version: '0.4.5-beta',
    date: '25 septembre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '045b1', platforms: ['web'], text: 'Palette zinc unique en sombre : zéro flash blanc, boutons primaires clairs, focus et appuis zinc, transition circulaire du thème' },
        ],
      },
    ],
  },
  {
    version: '0.4.4-beta',
    date: '23 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '145a1', platforms: ['web'], text: 'Tous les popups suivent le même système guidé : produit (3 étapes), facture d’achat (3 étapes), remboursement WR (2 étapes), reçu et fournisseur (2 étapes) — Annuler / Retour / Continuer toujours alignés à droite' },
          { id: '145a2', platforms: ['web'], text: 'Éditeur photo : zoom − / + / 1:1, double-clic ×2 et bouton « ↩ Original » pour revenir à la photo d’origine à tout moment' },
          { id: '145a3', platforms: ['web'], text: 'Zone de dépôt OCR redesignée (facture d’achat) : carte pointillée claire/sombre avec icône et aide au survol' },
          { id: '145a4', platforms: ['web'], text: 'Transition de thème façon PowerPoint : révélation circulaire depuis le centre de la fenêtre (View Transitions), sans blanc au chargement' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '145b1', platforms: ['web'], text: 'Zéro flash blanc : le thème enregistré est appliqué avant le premier rendu (page, squelettes, sélecteur de date)' },
          { id: '145b2', platforms: ['web'], text: 'Palette zinc unique en sombre : boutons primaires clairs (fini le noir/bleu marine), segments Apparence lisibles, focus et appuis zinc' },
          { id: '145b3', platforms: ['web'], text: 'Notes d’information des popups (WR, statuts de paiement) thémées : texte toujours lisible en clair et en sombre' },
          { id: '145b4', platforms: ['web'], text: 'Animations sobres : appui bouton, survol des cartes, pop des modales, squelettes décalés — désactivées si mouvement réduit' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '145c1', platforms: ['web'], text: 'Le tap hors d’un popup annule et réinitialise le formulaire (jamais d’enregistrement accidentel)' },
          { id: '145c2', platforms: ['web'], text: 'Erreurs affichées sous leur champ dans le popup (scan code-barres, lignes vides, montant de règlement)' },
          { id: '145c3', platforms: ['web'], text: 'Page Nouvelles : canevas sombre complet + entrée 1.4.5 (le gris clair résiduel a disparu)' },
          { id: '145c4', platforms: ['server'], text: 'Fiabilité worker : /api/public/github-profile mis en cache 6 h avec repli statique (plus de 503) ; migrations D1 silencieuses (PRAGMA d’abord)' },
        ],
      },
    ],
  },
  {
    version: '0.4.3-beta',
    date: '21 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '144a1', platforms: ['web'], text: 'Scan : code inconnu → demande de création produit (photo comprise), validée depuis la liste Produits' },
          { id: '144a2', platforms: ['web', 'android', 'server'], text: 'Mises à jour de l’application Android gérées depuis Paramètres (lien + APK via le serveur)' },
          { id: '144a3', platforms: ['web'], text: 'Formulaires guidés par étapes (employés) avec barre d’actions fixe : Retour / Continuer toujours au même endroit' },
          { id: '144a4', platforms: ['web'], text: 'Atlas Agent : « créer un client nommé X avec email/téléphone » ouvre directement la fiche pré-remplie à vérifier' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '144b1', platforms: ['web'], text: 'Thème sombre unifié partout : une seule palette zinc (fini les fonds bleu marine)' },
          { id: '144b2', platforms: ['web'], text: 'Menu du compte, sélecteur de dates (y compris plage) et boutons de période entièrement sombres' },
          { id: '144b3', platforms: ['server'], text: 'Suppressions et créations sensibles : simple confirmation, plus de mot de passe à ressaisir (la session + OTP protègent déjà)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '144c1', platforms: ['web'], text: 'Synchronisation des conversations Atlas Agent restaurée (erreur 404 sur les threads)' },
          { id: '144c2', platforms: ['web'], text: 'Page Nouveautés : entrée fantôme qui faisait plancher l’affichage corrigée' },
          { id: '144c3', platforms: ['web'], text: 'Tableau de bord : plus d’erreur 403 quand le module Pointage est désactivé' },
        ],
      },
    ],
  },
  {
    version: '0.4.2-beta',
    date: '18 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '143a1', platforms: ['web'], text: 'Thème sombre unifié (sidebar, topbar et pages sur la même palette zinc)' },
          { id: '143a2', platforms: ['web'], text: 'Fichier CSS final dark-force pour éviter les conflits de cascade' },
          { id: '143a3', platforms: ['android', 'server'], text: 'assetlinks.json restauré avec empreinte SHA-256 pour passkeys Android' },
          { id: '143a4', platforms: ['web', 'server'], text: 'Enregistrement passkey depuis le téléphone (session connectée, sans 403 appareil non de confiance)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '143b1', platforms: ['web'], text: 'Menus compte, mail et notifications entièrement adaptés au thème sombre' },
          { id: '143b2', platforms: ['web'], text: 'Plus de flash blanc au survol / au toucher des boutons en mode sombre' },
          { id: '143b3', platforms: ['web'], text: 'Texte secondaire neutre (gris) — plus de violet/indigo par défaut' },
          { id: '143b4', platforms: ['web'], text: 'Squelettes de chargement neutres (clair et sombre)' },
          { id: '143b5', platforms: ['web'], text: 'Page Nouveautés : icônes et textes lisibles en clair et en sombre' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '143c1', platforms: ['web'], text: 'Lignes blanches dans le pop-up Messagerie en thème sombre' },
          { id: '143c2', platforms: ['web'], text: 'Éléments blancs du menu utilisateur (Paramètres, Nouveautés, Déconnexion)' },
          { id: '143c3', platforms: ['web'], text: 'focus-pages-chrome.css qui forçait le blanc sur Paramètres en sombre' },
          { id: '143c4', platforms: ['web'], text: 'Arrière-plans verdâtres (#0b100e) retirés du thème sombre' },
          { id: '143c5', platforms: ['web'], text: 'Cartes KPI du tableau de bord avec la même surface' },
        ],
      },
    ],
  },
  {
    version: '0.4.1-beta',

    date: '16 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'a1', platforms: ['web'], text: 'États vides avec un bouton clair pour créer (devis, reçus, fournisseurs…)' },
          { id: 'a2', platforms: ['web'], text: 'Navigation regroupée par thèmes (Catalogue, Ventes, Achats, Finance)' },
          { id: 'a3', platforms: ['web'], text: 'Barre mobile plus confortable (gros boutons, libellés Accueil / Caisse / Réglages)' },
          { id: 'a4', platforms: ['web'], text: 'Favicon et icône d’accueil iPhone générés depuis le logo Atlas' },
          { id: 'a5', platforms: ['web'], text: 'Titre unique par page dans l’onglet du navigateur' },
          { id: 'a6', platforms: ['web'], text: 'Aperçu Open Graph / Twitter pour le partage de liens' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: 'b1', platforms: ['web'], text: 'Boutons d’action plus parlants (« Ajouter un produit », « Entrer dans Atlas »…)' },
          { id: 'b2', platforms: ['web'], text: 'Export Excel CSV en style blanc, aligné avec PDF Stock et Réassort' },
          { id: 'b3', platforms: ['web'], text: 'Pagination : flèches blanches au repos, noires au survol uniquement' },
          { id: 'b4', platforms: ['web'], text: 'Recherche produits plus précise (index de recherche)' },
          { id: 'b5', platforms: ['web'], text: 'Couleurs d’accent unifiées sur le noir de marque (plus de bleu par défaut)' },
          { id: 'b6', platforms: ['web'], text: 'Cibles tactiles plus grandes sur téléphone' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'c1', platforms: ['web'], text: 'Textes des états vides qui restaient dans leur carte' },
          { id: 'c2', platforms: ['web'], text: 'Messages d’erreur techniques masqués (plus de détail base de données)' },
          { id: 'c3', platforms: ['web'], text: 'Erreur « Erreur interne » au chargement produits en cas d’échec recherche' },
          { id: 'c4', platforms: ['web'], text: 'Boutons de filtre Nouveautés opérationnels (Tout / Ajouté / Amélioré / Corrigé)' },
        ],
      },
    ],
  },
  {
    version: '0.4.0-beta',
    date: '14 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'd1', platforms: ['server'], text: 'Restauration de sauvegarde plus rapide (ignore ce qui existe déjà)' },
          { id: 'd2', platforms: ['web'], text: 'Fenêtre de restauration fixe au centre, avec le détail de progression' },
          { id: 'd3', platforms: ['web'], text: 'Rédaction d’e-mails (nouveau, répondre, transférer) en fenêtre centrée' },
          { id: 'd4', platforms: ['web'], text: 'Export CSV / rapports avec étapes animées' },
          { id: 'd5', platforms: ['web', 'server'], text: 'Pagination avec chiffres animés' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: 'e1', platforms: ['web'], text: 'Graphiques du tableau de bord et du solde sur données réelles' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'f1', platforms: ['server'], text: 'Chiffres du compte à rebours Supprimer bien visibles (blanc)' },
          { id: 'f2', platforms: ['web'], text: 'Boutons Supprimer toujours rouges' },
          { id: 'f3', platforms: ['web'], text: 'Pagination « N sur M » stable, sans saut de mise en page' },
        ],
      },
    ],
  },
  {
    version: '0.3.4-beta',
    date: '10 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'a1b2c3d', platforms: ['web'], text: 'Shell revisité : top bar, menu avatar, notifications, recherche' },
          { id: 'e5f6g7h', platforms: ['web'], text: 'Suppression temporisée rouge (10 s) — annulation si onglet masqué' },
          { id: 'i8j9k0l', platforms: ['web'], text: 'Nouveaux graphiques tableau de bord et solde (barres, données live)' },
          { id: 'm1n2o3p', platforms: ['web', 'server'], text: 'Atlas Agent : PromptBar, LatticeLoader, historique R2 (30 j)' },
          { id: 'p4q5r6s', platforms: ['web'], text: 'Pagination pilule (N sur M) — listes & messagerie' },
          { id: 't7u8v9w', platforms: ['web'], text: 'Changelog Nouveautés (sections Nouveautés / Corrections / Majeurs)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'x0y1z2a', platforms: ['web'], text: 'Purge des effets de verre, teal et résidus verts (web + mobile)' },
          { id: 'b3c4d5e', platforms: ['web'], text: 'Login Auth7, cases noires, personnages ; barre Agent lisible' },
          { id: 'f6g7h8i', platforms: ['web'], text: 'Bouton Supprimer fixe (plus de troncature ni saut de layout)' },
        ],
      },
    ],
  },
  {
    version: '0.3.3-beta',
    date: '7 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'j9k0l1m', platforms: ['web'], text: 'Erreurs de formulaire en français dans la popup' },
          { id: 'n2o3p4q', platforms: ['web'], text: 'Atlas Agent masqué pendant les modales' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'r5s6t7u', platforms: ['web'], text: 'Remboursement centré, flou plein écran' },
          { id: 'v8w9x0y', platforms: ['web'], text: 'Popups mal centrées sur plusieurs pages' },
        ],
      },
    ],
  },
  {
    version: '0.3.2-beta',
    date: '4 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'z1a2b3c', platforms: ['web'], text: 'Messagerie focus (top bar, sans sidebar app)' },
          { id: 'd4e5f6g', platforms: ['web'], text: 'Scanner Quagga2' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'h7i8j9k', platforms: ['web'], text: 'Filtres boîte / envoyés / tous ; spam & archives' },
          { id: 'l0m1n2o', platforms: ['web'], text: 'Pagination messagerie sans fuite entre pages' },
        ],
      },
    ],
  },
  {
    version: '0.3.1-beta',
    date: '1 septembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p3q4r5s', platforms: ['web'], text: 'Recherche Paramètres (historique, aperçu)' },
          { id: 't6u7v8w', platforms: ['web'], text: 'Atlas Agent mobile + barre du bas fixe' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'x9y0z1a', platforms: ['server'], text: 'PBKDF2 Workers (itérations supportées)' },
          { id: 'b2c3d4e', platforms: ['web'], text: 'Scan caméra / WASM réseau' },
        ],
      },
    ],
  },
  {
    version: '0.3.0-beta',
    date: '29 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'f5g6h7i', platforms: ['web'], text: 'Mode focus Paramètres / À propos / Nouveautés' },
          { id: 'j8k9l0m', platforms: ['web'], text: 'Page Nouveautés + menu utilisateur' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'n1o2p3q', platforms: ['web'], text: 'Animations de page et transitions shell' },
        ],
      },
    ],
  },
  {
    version: '0.2.0-beta',
    date: '24 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'r4s5t6u', platforms: ['web'], text: 'Employés, cycles de paie, acomptes' },
          { id: 'v7w8x9y', platforms: ['web'], text: 'Présence / pointage (option Paramètres)' },
          { id: 'z0a1b2c', platforms: ['web', 'server'], text: 'Fiche employé imprimable + pièce ID chiffrée R2' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'd3e4f5g', platforms: ['web', 'server'], text: 'Numérotation Durable Object ; refresh listes' },
        ],
      },
    ],
  },
  {
    version: '0.1.8-beta',
    date: '19 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'h6i7j8k', platforms: ['web', 'server'], text: 'Boîte mail pro (dossiers, pièces jointes, spam)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'l9m0n1o', platforms: ['web'], text: 'Lecture corps mail pleine page (scroll document)' },
        ],
      },
    ],
  },
  {
    version: '0.1.7-beta',
    date: '15 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p2q3r4s', platforms: ['web'], text: 'Aperçu documents (PDF / images) dans la messagerie' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 't5u6v7w', platforms: ['web'], text: 'Styles boutons secondaires (refresh) unifiés' },
        ],
      },
    ],
  },
  {
    version: '0.1.6-beta',
    date: '12 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'x8y9z0a', platforms: ['web'], text: 'Rapports stock / ventes ; historique produit' },
        ],
      },
    ],
  },
  {
    version: '0.1.5-beta',
    date: '8 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'b1c2d3e', platforms: ['web', 'server'], text: 'Reçus, remboursements, vente rapide' },
        ],
      },
    ],
  },
  {
    version: '0.1.4-beta',
    date: '5 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'f4g5h6i', platforms: ['web'], text: 'Devis convertibles ; factures FA / VR' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: 'j7k8l9m', platforms: ['web'], text: 'Calcul HT/TTC et libellés prix' },
        ],
      },
    ],
  },
  {
    version: '0.1.3-beta',
    date: '1 août 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'n0o1p2q', platforms: ['web'], text: 'Clients, fournisseurs, crédit client' },
        ],
      },
    ],
  },
  {
    version: '0.1.2-beta',
    date: '28 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'r3s4t5u', platforms: ['web'], text: 'Achats fournisseurs + réception stock' },
        ],
      },
    ],
  },
  {
    version: '0.1.1-beta',
    date: '24 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'v6w7x8y', platforms: ['web'], text: 'Solde trésorerie (recettes, dépenses, apports)' },
        ],
      },
    ],
  },
  {
    version: '0.1.0-beta',
    date: '21 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'z9a0b1c', platforms: ['web', 'server'], text: 'Catalogue produits, catégories, images R2' },
        ],
      },
    ],
  },
  {
    version: '0.0.4-beta',
    date: '16 juillet 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: 'd2e3f4g', platforms: ['web', 'server'], text: 'Stabilisation auth session et cookies' },
        ],
      },
    ],
  },
  {
    version: '0.0.3-beta',
    date: '12 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'h5i6j7k', platforms: ['web'], text: 'Tableau de bord métriques de base' },
        ],
      },
    ],
  },
  {
    version: '0.0.2-beta',
    date: '9 juillet 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: 'l8m9n0o', platforms: ['web', 'server'], text: 'Correctifs post-publication login / routing' },
        ],
      },
    ],
  },
  {
    version: '0.0.1-beta',
    date: '6 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p1q2r3s', platforms: ['web', 'server'], text: 'Première publication Atlas Commerce (stock, caisse, facturation)' },
          { id: '001a1', platforms: ['web', 'server'], text: 'Première version interne (bêta) : stock, facturation et espace de travail Atlas Commerce' },
        ],
      },
      {
        kind: 'breaking',
        items: [
          { id: 't4u5v6w', platforms: ['server'], text: 'Canal beta uniquement — versions stables à venir' },
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
    // v0.7.7 — gel directive : rien au-delà de 0.7.2 n'est exposé publiquement.
    return RELEASES.filter((r) => semverAtMost(r.version, RELEASE_VISIBLE_CAP)).map((rel) => ({
      ...rel,
      sections: rel.sections.filter((sec) => {
        if (filter === 'all') return true;
        const meta = KIND_META[sec.kind];
        return meta.filter === filter;
      }),
    })).filter((rel) => rel.sections.length > 0);
  }, [filter]);

  // v0.7 — public reading: breadcrumb targets /login when there is no session.
  const wnLoggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  return (
    <div className="wn-changelog">
      <nav className="wn-crumb" aria-label="Fil d'Ariane">
        {wnLoggedIn
          ? <Link to="/">Accueil</Link>
          : <span>Atlas Commerce</span>}
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

      <div className="wn-releases">
        {releases.map((rel, ri) => (
          <motion.section
            key={rel.version}
            className="wn-release"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(ri * 0.02, 0.4), duration: 0.28 }}
          >
            <h2 className="wn-ver" id={`v-${rel.version}`}>
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
                        {it.platforms && it.platforms.length > 0 ? (
                          <span className="wn-plats" aria-label="Plateformes concernées">
                            {it.platforms.map((pl) => (
                              <em key={pl} className={`wn-plat wn-plat--${pl}`}>{PLAT_LABEL[pl]}</em>
                            ))}
                          </span>
                        ) : null}
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
