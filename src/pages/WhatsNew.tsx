import { useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Wrench, AlertCircle, ArrowUpCircle, Heart, Users } from 'lucide-react';
import { RELEASE_VISIBLE_CAP, semverAtMost } from '../version';
import { markWhatsNewSeen } from '../lib/whatsNew';
import {
  REPO_CONTRIBUTORS,
  fetchRepoContributors,
  getContributorsForRelease,
  type Contributor,
} from '../lib/contributors';

type SectionKind = 'features' | 'improvements' | 'fixes' | 'breaking';

type Platform = 'web' | 'android' | 'desktop' | 'server';

export const PLAT_LABEL: Record<Platform, string> = {
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


// 0.9.4 release notes; publication happens when this branch is deployed.
export const UPCOMING_RELEASE_094: Release = {
  version: '0.9.4',
  date: '27 novembre 2026',
  sections: [
    { kind: 'improvements', items: [
      { id: '094i1', platforms: ['web', 'android'], text: 'Langues : traduction élargie en arabe et en anglais, avec des améliorations de la mise en page de droite à gauche.' },
      { id: '094i10', platforms: ['web', 'android'], text: 'Les langues arabe et anglaise sont en cours de développement et nécessitent encore des améliorations.' },
      { id: '094i2', platforms: ['web'], text: 'Navigation : calendrier et pagination améliorés, et davantage de place pour les pages lorsque Atlas Agent est ouvert.' },
      { id: '094i3', platforms: ['web'], text: 'Pour tous : Atlas Commerce se rapproche de sa sortie de bêta. Merci de nous accompagner !' },
      { id: '094i4', platforms: ['desktop'], text: 'À suivre : une application bureau inspirée du site, avec des fonctionnalités, un cache et un démarrage avec votre ordinateur. Nous visons une expérience plus légère que Chrome ; les performances restent à mesurer.' },
      { id: '094i5', platforms: ['web', 'android'], text: "Traductions : des fichiers séparés facilitent les corrections communautaires en français, en anglais et en arabe ; merci aux personnes qui contribuent aux traductions." },
      { id: '094i6', platforms: ['web', 'server'], text: "Mode démo : le compte à rebours est synchronisé avec la session et Atlas Agent affiche un message lorsque la limite de démo est atteinte." },
      { id: '094i7', platforms: ['web'], text: "Paramètres : les onglets déjà ouverts restent disponibles pendant le rafraîchissement et les formulaires de gestion utilisent des fenêtres dédiées." },
      { id: '094i8', platforms: ['server'], text: "Sécurité : les e-mails de connexion et de confirmation de suppression des conversations Atlas Agent sont disponibles en français, anglais et arabe." },
      { id: '094i9', platforms: ['server'], text: "Historique Agent : les anciennes conversations au format pris en charge sont chiffrées lors de la prochaine réponse ; les formats non reconnus restent protégés." },
    ] },
  ],
};

export const RELEASES: Release[] = [
  UPCOMING_RELEASE_094,
  {
    version: '0.9.3',
    date: '25 novembre 2026',
    sections: [{ kind: 'features', items: [
      { id: '093n4', platforms: ['web'], text: 'Tableau de bord : quatrième graphique « Répartition des charges » (principales catégories de dépenses hors achats), toujours affiché, avec des lignes à 0 MAD tant qu’il n’y a pas de données ; graphiques reliés aux données réelles et rafraîchis après chaque modification.' },
      { id: '093n3', platforms: ['web', 'server'], text: 'Paie : jours déclarés CNSS par employé (26 jours par mois au maximum) dans l’assistant Employé, modifiables sur chaque ligne de paie ; 0 jour signifie sans CNSS/AMO ; colonne « Jours déclarés CNSS » dans les exports CSV et Excel ; préréglages 26, 22 et 13 jours.' },
      { id: '093n1', platforms: ['desktop', 'server'], text: 'Connexion desktop native sans navigateur : mot de passe + code reçu par e-mail, QR approuvé depuis le téléphone et passkey Windows Hello, avec jetons DPoP liés à l’appareil et aucune fenêtre de navigateur.' },
      { id: '093n2', platforms: ['desktop', 'server'], text: 'Option « Rester connecté » sur desktop, à activer à chaque connexion : session limitée côté serveur à 30 jours maximum (12 h par défaut, jamais prolongée par le rafraîchissement), rotation des jetons avec détection de réutilisation et révocation à la déconnexion, au changement de mot de passe ou par un administrateur.' },
      { id: '093n5', platforms: ['web'], text: 'Paramètres : une fenêtre flottante apparaît dès qu’un réglage change, avec « Annuler » et « Enregistrer », puis confirme « Paramètres enregistrés ».' },
      { id: '093n6', platforms: ['web'], text: 'Langue : nouvelle entrée « Langue » dans les Paramètres et dans le menu utilisateur ; choix entre français, arabe (de droite à gauche) et anglais, mémorisé sur l’appareil et partagé avec l’app Android.' },
      { id: '093n7', platforms: ['web'], text: 'Visite guidée après le guide de bienvenue : Atlas Commerce ouvre chaque page et montre quoi faire — Produits puis « Ajouter un produit », un client, une facture, une vente rapide, la caisse, Atlas Agent et le menu du compte — avec Suivant, Précédent et Passer ; à revoir depuis Paramètres → Mon profil. C’est une simple démonstration : la page derrière ne réagit pas aux clics pendant la visite, rien n’est ajouté à la base de données et elle se passe à tout moment.' },
      { id: '093n8', platforms: ['web'], text: 'Densité « Compacte » de nouveau active sur ordinateur : boutons, champs, cartes, tableaux, pagination, barre latérale et barre flottante du haut se resserrent ; réglage aussi disponible dans Paramètres → Mon profil. Le mobile reste en densité confortable.' },
      { id: '093n9', platforms: ['web'], text: 'Déconnexion : une confirmation « Se déconnecter ? » apparaît avant de fermer la session, depuis le menu utilisateur de l’application comme depuis les pages publiques.' },
      { id: '093n10', platforms: ['web'], text: 'Pages publiques : bouton « Langue » pour les visiteurs non connectés, à côté du choix du thème (français, arabe, anglais).' },
      { id: '093n11', platforms: ['web'], text: 'Vraies captures d’écran, en thème clair et sombre, sur l’accueil, la page Desktop, le guide de bienvenue et le README, à la place des maquettes dessinées.' },
      { id: '093n12', platforms: ['web', 'server'], text: 'Cartes de chiffres façon tableau de bord pro sur toutes les pages (accueil, solde, factures, devis, ventes rapides, produits, clients, fournisseurs, employés, actions, caisse, stock, rapports, journal) : grande valeur, variation en % par rapport à la période précédente avec flèche verte ↗ ou rouge ↘ (couleurs inversées quand une hausse est mauvaise : stock bas, dépenses, créances, dettes…), et courbe des 14 derniers jours avec valeur au survol. Sans données, une ligne discrète et la pastille « Aucune donnée ».' },
      { id: '093n13', platforms: ['web'], text: 'Logo animé : le soleil Atlas se dessine au démarrage (rayons tracés un à un, trait qui s’allonge vers « Atlas », puis le nom apparaît) et, dans la barre latérale, « Atlas » se replie dans le symbole quand on la réduit. Vectoriel, net sur tous les écrans, sans son ; mouvement réduit respecté.' },
      { id: '093n14', platforms: ['web'], text: 'Atlas Agent (mobile web) : pendant que l’agent prépare sa réponse, une bulle squelette scintillante remplace les trois points, avec le soleil Atlas qui tourne.' },
      { id: '093n15', platforms: ['web'], text: 'Auteur des documents et des mouvements : les factures, devis et ventes rapides affichent « Créé par » dans leurs listes, et chaque transaction de la balance comme chaque mouvement de stock reprend le nom de la personne qui a créé la facture ou la vente rapide d’origine.' },
      { id: '093n16', platforms: ['web'], text: 'Mobile web : cartes d’indicateurs avec mini-graphiques et tendance sur l’Accueil, les Employés, les Clients et le Scan (ventes, encaissements, mouvements de stock, présences, créances…) ; elles se balayent du doigt et partagent les mêmes chiffres que l’ordinateur.' },
      { id: '093n17', platforms: ['web'], text: 'Scan (mobile web) : bouton « Ajouter un produit » en haut de la page ; « Hors ligne » n’apparaît que sans connexion ; la saisie manuelle du code-barres ou du SKU s’affiche seulement si la lecture a échoué ; les boutons Image et Contrôle rayon et la liste « Envoyés aujourd’hui » sont retirés.' },
      { id: '093n18', platforms: ['web', 'android', 'server'], text: 'Mode démo : connectez-vous avec « test » / « test » pour essayer Atlas sur une base fictive séparée, que vous pouvez modifier librement ; vos vraies données ne sont jamais touchées. 1 heure par appareil toutes les 24 heures, puis la base de démo est remise à zéro ; un avertissement s’affiche à la connexion et un compteur reste visible.' },
      { id: '093n19', platforms: ['web', 'server'], text: 'Rapports & crashs : chaque application a désormais son propre dépôt et son propre jeton (web et Android, dans Paramètres → API & Clés), et une analyse automatique facultative propose pour chaque nouveau ticket un titre clair, une gravité, la zone concernée et des pistes de correction.' },
      { id: '093n20', platforms: ['web', 'server'], text: 'Journal d’audit : chaque appel à l’API est enregistré, y compris les échecs (statut, durée, route), et conservé 30 jours au maximum ; nouveau panneau « Journal des appels API » avec filtres.' },
      { id: '093n21', platforms: ['web', 'server'], text: 'Adresse IP du journal : ville, pays, opérateur et repère VPN / proxy / hébergeur ; bouton « Expliquer » qui décrit une ligne du journal en langage clair.' },
      { id: '093n22', platforms: ['web'], text: 'Rapports GitHub : « Crashs récents » et « Signalements utilisateurs » paginés par 10, et les signalements qui se ressemblent sont regroupés dans une section (5 groupes par page).' },
      { id: '093n23', platforms: ['web'], text: 'Listes déroulantes redessinées : plus de libellé coupé (« Toutes catégories »), recherche dans les longues listes, thème sombre et clavier pris en charge.' },
      { id: '093n24', platforms: ['web'], text: 'Cases à cocher redessinées dans toute l’application, y compris « Se souvenir de moi » à la connexion sur ordinateur et mobile.' },
      { id: '093n25', platforms: ['web', 'android'], text: 'Langue sur mobile : le réglage « Langue » ouvre désormais le vrai choix français / arabe / anglais.' },
      { id: '093n26', platforms: ['web', 'server'], text: 'Bons de livraison imprimables depuis les factures et les ventes rapides, sans prix et avec signatures.' },
      { id: '093n27', platforms: ['web'], text: 'Accueil mobile : graphiques des mouvements de stock et de la trésorerie, et indicateurs plus compacts.' },
    ] }, { kind: 'improvements', items: [
      { id: '093i1', platforms: ['web'], text: 'Navigation entre les pages réécrite sur toutes les listes (Produits, Factures, Devis, Reçus, Achats, Clients, Fournisseurs, Employés, Pointage, Balance, Remboursements, Vente rapide, Boîte d’actions et Journal d’audit) : numéros de page avec points de suspension, page courante animée, navigation au clavier (flèches, Début, Fin) et rendu soigné en thème clair comme en sombre.' },
      { id: '093i2', platforms: ['web'], text: 'Tableau de bord : « Voir la balance », « Voir la boîte », « Voir le catalogue » et « Ouvrir » deviennent de vrais boutons arrondis avec flèche animée au lieu de liens soulignés.' },
      { id: '093i3', platforms: ['web'], text: 'Chargement : squelette du tableau de bord identique à la nouvelle mise en page (graphiques 2×2, anneaux et listes) et nouveau squelette éditorial pour l’accueil et les pages Android, Desktop et Support, en clair et en sombre, sans animation lorsque la réduction des animations est activée.' },
      { id: '093i4', platforms: ['web'], text: 'Thème sombre charbon neutre unifié sur les surfaces, tableaux, menus, fenêtres et graphiques, sur ordinateur comme sur mobile ; surfaces blanches en thème clair comme sur Android et Atlas Agent mobile harmonisé.' },
      { id: '093i5', platforms: ['web', 'server'], text: 'Nettoyage du code : 38 fichiers et exports inutilisés retirés, analyse statique à 0 avertissement et 0 erreur ; les e-mails du desktop réutilisent le service d’envoi déjà configuré pour le site.' },
      { id: '093i6', platforms: ['web'], text: 'Barre flottante du haut : le titre ne ressemble plus à un bouton ; un appui agrandit la barre avec une animation fluide et les commandes glissent en place ; titres en casse normale (« Tableau de bord »).' },
      { id: '093i7', platforms: ['web'], text: 'Thème sombre : nouvelle passe sur les boutons et badges, le bouton « Enregistrer » des Paramètres, le bandeau de rapprochement du Solde et la légende du catalogue.' },
      { id: '093i8', platforms: ['web'], text: 'Guide de bienvenue : « Visite rapide des modules » devient une simple information (non cliquable), le comparatif papier / Atlas est conservé et le titre « Bonjour » n’affiche plus de contour orange.' },
      { id: '093i9', platforms: ['web'], text: 'Bandeau cookies : « Retour », « Personnaliser » et la croix de fermeture sont de vrais boutons au lieu de liens soulignés.' },
      { id: '093i10', platforms: ['web'], text: 'Paramètres : Paie CNSS / AMO, Plan comptable (FEC) et Relances impayés s’ouvrent directement depuis la barre des Paramètres.' },
      { id: '093i11', platforms: ['desktop'], text: 'Client bureau : références visuelles mises à jour (captures 1280×800 en clair et en sombre de chaque page, de chaque section des Paramètres, d’Atlas Agent, du menu du compte, de la confirmation de déconnexion et de la visite guidée, avec les mesures de chaque élément).' },
      { id: '093i12', platforms: ['web'], text: 'Nettoyage : ancienne visite à cartes, maquettes dessinées, scripts de capture obsolètes et règles de style inutilisées retirés.' },
      { id: '093i13', platforms: ['web'], text: 'Barre d’actions en haut à droite : icônes plus nettes quand elle est dépliée ; une fois réduite, seul le bouton survolé (ou sélectionné au clavier) s’élargit pour afficher son nom, sans déplier toute la barre.' },
      { id: '093i14', platforms: ['web'], text: 'Barre flottante du haut : la flèche de retour (« ← Paramètres ») laisse place à un bouton « Tableau de bord » séparé, à gauche, qui n’affiche que son icône et révèle son nom au survol.' },
      { id: '093i15', platforms: ['web'], text: 'Journal d’audit : périodes 24 h / 7 j / 30 j / Tout, « Actualiser » et « Export CSV » regroupés au-dessus de la recherche ; pagination en haut à côté de « Historique détaillé » ; menu « 7 derniers jours » en double retiré ; la colonne Détail n’a plus l’air d’un lien (toute la ligne s’ouvre).' },
      { id: '093i16', platforms: ['web'], text: 'Tableaux harmonisés sur toutes les listes (employés, factures, devis, clients, fournisseurs, passkeys, journal…) : en-têtes sobres, espacement régulier, séparateurs fins, survol discret ; numéros et montants ne se coupent plus sur deux lignes.' },
      { id: '093i17', platforms: ['web'], text: 'Visite guidée mobile : chaque étape ouvre vraiment sa page (Produits, Atlas Agent, Profil) au lieu de seulement la montrer, puis revient à l’accueil à la fin.' },
      { id: '093i18', platforms: ['web'], text: 'Bouton retour sur les pages de détail (historique d’un produit, facture, vente rapide) à la place de « Tableau de bord », qui n’apparaît plus que sur Paramètres, À propos et Licences. Les deux restent déployés en haut de page et se réduisent dès que l’on fait défiler.' },
      { id: '093i19', platforms: ['web'], text: 'Logo Atlas animé partout : les rayons se dessinent, le trait central s’allonge vers « Atlas » et reste visible quand la barre latérale est réduite ; le même logo animé apparaît sur l’accueil, Support, Bureau et Android.' },
      { id: '093i20', platforms: ['web'], text: 'Connexion : le logo Atlas est maintenant animé (rayons, trait central puis « Atlas », suivi d’une légère vague), plus grand, et garde exactement la même taille en thème clair comme en sombre. Le petit logo des pages Nouveautés, À propos et légales s’anime aussi, sur ordinateur comme sur téléphone, et réagit au toucher.' },
      { id: '093i21', platforms: ['web'], text: 'Captures d’écran des pages Accueil, Android et Bureau : en thème sombre, les aperçus mobile et ordinateur passent eux aussi en sombre.' },
      { id: '093i22', platforms: ['web'], text: 'Moins de lectures en base de données : les graphiques d’indicateurs ne recalculent plus tout après chaque enregistrement (au plus une fois par minute, filtres par date indexés), la sauvegarde automatique respecte vraiment son rythme de 12 heures, et les vérifications de structure ne sont faites qu’une fois au lieu d’à chaque requête.' },
      { id: '093i23', platforms: ['web'], text: 'Notifications : les messages (erreurs comprises) s’affichent désormais en bas de l’écran, au-dessus de la barre d’onglets et de la barre « Modifications non enregistrées » ; le message « N sauvegarde(s) » à l’ouverture des Paramètres disparaît.' },
      { id: '093i24', platforms: ['web'], text: 'Paramètres : la barre « Modifications non enregistrées » apparaît dès la première saisie, dans n’importe quel champ ; les boutons d’enregistrement de la page restent disponibles. Les champs « Choisir un fichier » ont un nouveau style (zone en pointillés et bouton arrondi), en clair comme en sombre.' },
      { id: '093i25', platforms: ['web'], text: 'Barre latérale des Paramètres et d’À propos : repliée, elle est maintenant plus compacte que dépliée ; À propos affiche ses chiffres en grille 2 × 2 et son titre n’est plus caché par la barre du haut sur téléphone.' },
      { id: '093i26', platforms: ['web', 'server'], text: 'Moins de lectures en base de données : index pour les clients et fournisseurs, structure des tables mémorisée plus longtemps, rafraîchissement des produits du tableau de bord espacé.' },
      { id: '093i27', platforms: ['web', 'server'], text: 'Tableau de bord plus léger : son rafraîchissement ne recharge plus la fiche complète de chaque produit, seulement les colonnes affichées ; la liste produits et le scan de code-barres ne relisent plus la structure de la table à chaque appel.' },
    ] }, { kind: 'fixes', items: [
      { id: '093f1', platforms: ['web'], text: 'Passkeys web : l’enregistrement et la connexion par passkey fonctionnent de nouveau.' },
      { id: '093f2', platforms: ['web', 'server'], text: 'Paie : fenêtre de réglages CNSS/AMO corrigée, fenêtres affichées en plein écran et téléchargement des documents de paie rétabli.' },
      { id: '093f3', platforms: ['web'], text: 'Mobile : lignes du menu utilisateur aplaties, bouton « Copier » placé dans la bulle de l’agent et contrastes du thème sombre corrigés.' },
      { id: '093f4', platforms: ['web'], text: 'Journal d’audit en thème sombre : lignes du tableau de nouveau lisibles (plus de lignes blanches) et icône de recherche qui ne chevauche plus le texte.' },
      { id: '093f5', platforms: ['web'], text: 'Bandeau cookies en thème sombre : boutons et lien « Personnaliser » corrigés.' },
      { id: '093f6', platforms: ['web'], text: 'Fenêtres « Connexion par QR », guide et profil : la page reste visible derrière en thème sombre, avec un fond translucide au lieu d’un aplat opaque.' },
      { id: '093f7', platforms: ['web'], text: 'Paramètres « Atlas Agent » et « Mise à jour app » : une réponse incomplète du serveur n’interrompt plus la page.' },
      { id: '093f8', platforms: ['web'], text: 'Solde en thème sombre : l’en-tête du rapprochement n’est plus blanc.' },
      { id: '093f9', platforms: ['web'], text: 'Mobile : page « Scanner un appareil » en thème sombre et boutons retour aux couleurs de la barre flottante, sans contour.' },
      { id: '093f10', platforms: ['web'], text: 'Atlas Agent : le quota n’affiche plus « NaN » quand la limite est inconnue, une limite inconnue ne bloque plus l’envoi et les boutons de l’en-tête sont lisibles en thème sombre.' },
      { id: '093f11', platforms: ['web'], text: 'Clôtures de caisse : une réponse incomplète du serveur n’interrompt plus la page.' },
      { id: '093f12', platforms: ['web'], text: 'Photo de profil : elle s’affiche de nouveau à chaque fois et plus vite ; chaque actualisation du profil ne recharge plus l’image (qui pouvait rester sur les initiales) et un échec de chargement est réessayé automatiquement.' },
      { id: '093f13', platforms: ['web'], text: 'Fenêtres qui s’ouvraient ou se fermaient toutes seules : la fenêtre « Langue » et la confirmation de déconnexion ne disparaissent plus quand la barre du haut se rétracte au défilement, le menu mobile des pages publiques ne les ferme plus, et « Nouveautés » attend la fin de la visite guidée et des autres fenêtres avant de s’afficher.' },
      { id: '093f14', platforms: ['web'], text: 'Barre d’actions réduite : les icônes s’affichent de nouveau au lieu de carrés vides ou de points.' },
      { id: '093f15', platforms: ['web'], text: 'Nouveautés : le fil d’Ariane « Accueil › Nouveautés » est retiré ; la page reste centrée et ne bouge plus quand on ouvre ou réduit la barre latérale. Paramètres et À propos, eux, s’élargissent pour suivre la barre.' },
      { id: '093f16', platforms: ['web'], text: 'Visite guidée mobile : le halo de l’étape « Scanner » entoure tout le bouton, y compris le rond surélevé.' },
      { id: '093f17', platforms: ['web'], text: 'Barre d’actions réduite : boutons ronds alignés, icônes parfaitement centrées, plus de carré dans le cercle (bouton « À jour ») ; bouton « Tableau de bord » aligné sur la barre latérale réduite, dont les icônes sont plus lisibles.' },
      { id: '093f18', platforms: ['web', 'server'], text: 'Migration de base de données : la base cible « atlas-db » est liée par son nom (DB_TARGET) à chaque déploiement, et l’action GitHub utilise les secrets CF_API_TOKEN et CF_ZONE_ID déjà présents (identifiant du compte déduit de la zone).' },
      { id: '093f19', platforms: ['web'], text: 'Assistants (fiche employé et formulaires en étapes) : la fenêtre tremble à chaque tentative de passer une étape incomplète, et « Annuler », la croix, Échap ou un clic à l’extérieur demandent « Abandonner la saisie ? » avant de fermer.' },
      { id: '093f20', platforms: ['web'], text: 'Barre du haut sur petit téléphone : le bouton de langue ne laisse plus de fond gris après un appui, garde la même hauteur que le choix du thème, et le bouton menu ne passe plus sous les autres boutons (« Se connecter » devient « Connexion » sur les écrans étroits).' },
      { id: '093f21', platforms: ['web'], text: 'Produits : la page ne plante plus si les statistiques des 7 derniers jours arrivent incomplètes ; les tendances sont simplement masquées.' },
      { id: '093f22', platforms: ['web'], text: 'Connexion : le bouton « Continuer » reste lisible au survol et quand on le touche sur téléphone, en clair comme en sombre ; le texte de l’identifiant n’est plus pâle.' },
      { id: '093f23', platforms: ['web', 'server'], text: 'Rapports & crashs : « Renvoyer la file » crée de nouveau les tickets (les envois étaient bloqués avant d’atteindre GitHub, comme certains e-mails) ; les plantages identiques sont regroupés dans un seul ticket et les envois restent dans les limites de l’offre gratuite.' },
      { id: '093f24', platforms: ['web'], text: 'Plusieurs pages (Tableau de bord, Employés, Clients, Produits, Factures, Paramètres…) ne plantent plus quand le pointeur quitte la fenêtre depuis la barre flottante ; les erreurs dues aux extensions du navigateur ne sont plus remontées.' },
      { id: '093f25', platforms: ['web'], text: 'Menu hamburger des pages publiques : l’ouvrir ne décale plus la page ; boutons « Modifier », actions des lignes produit, cartes de l’accueil et pied des assistants qui ne débordent plus.' },
      { id: '093f26', platforms: ['web'], text: 'Menu des pages À propos, Nouveautés et légales en thème sombre : le voile derrière le menu reste translucide au lieu de masquer la page.' },
      { id: '093f27', platforms: ['web', 'server'], text: 'Mode démo : la liste produits légère fonctionne dès la première ouverture d’une base neuve, le compte démo s’affiche « Compte démo » sur mobile, et « Sauvegarder maintenant » explique clairement qu’il est indisponible en démo.' },
    ] }],
  },
  {
    version: '0.9.2',
    date: '24 novembre 2026',
    sections: [{ kind: 'improvements', items: [
      { id: '092i1', platforms: ['web'], text: 'Interfaces de chargement harmonisées : squelettes animés (.skeleton et PageSkeleton) sur les listes, détails, rapports, opérations de stock et panneaux de réglages à la place des textes bruts.' },
      { id: '092i2', platforms: ['web'], text: 'Rapports et filtres de dates : sélecteur DateRangePicker avec raccourcis rapides (7j, 1m, 6m, 1a, 2a, YTD) aligné sur le tableau de bord et menus déroulants corrigés sans rognage de texte.' },
      { id: '092i3', platforms: ['web'], text: 'Pages publiques, légales et barre supérieure : menu utilisateur unifié avec accès direct au tableau de bord, boutons de recherche globale redondants retirés et mise en page focus/légale centrée.' },
      { id: '092i4', platforms: ['web'], text: 'Écrans Bento allégés : suppression des titres redondants dans Rapports, Opérations stock, Paie et Clôtures de caisse (indicateurs de lot et de session replacés dans leurs panneaux), barre de date du pointage alignée sur le tableau de bord et squelettes de chargement affinés.' },
    ] }, { kind: 'features', items: [
      { id: '092n1', platforms: ['desktop', 'server'], text: 'Authentification Desktop v3 et cœur Rust atlas-auth-core : jetons nv3. contraints par preuve DPoP ES256 et nonce D1 à usage unique, boîte e-mail vérifiée dédiée, récupération approuvée par administrateur et suite de contrat Rust ↔ Worker.' },
      { id: '092n2', platforms: ['web', 'server'], text: 'Modules ERP & conformité Maroc : clôtures de caisse (X / Z), paie mensuelle (CNSS / AMO / IGR), pointage avec fiche présence (cycle de paie et carrière), export comptable FEC, suivi des relances et adaptateur de télédéclaration DGI.' },
      { id: '092n3', platforms: ['web', 'android', 'server'], text: 'Inventaire hors ligne et clients mobiles : contrat de synchronisation idempotente multi-dépôts hors ligne, annuaire Clients et fiche Employés sur web mobile et aperçus isolés.' },
    ] }, { kind: 'fixes', items: [
      { id: '092f1', platforms: ['web'], text: 'Connexion mobile : suppression du lien « ••• », centrage de la carte et verrouillage du défilement horizontal.' },
      { id: '092f2', platforms: ['web'], text: 'Thème sombre unifié (#121317 / #181a20) : contraste de la barre flottante, exclusion des boutons de navigation/date des styles génériques et carte dédiée pour les modules désactivés (Pointage).' },
      { id: '092f3', platforms: ['web'], text: 'Actions entrepôts et modale Pointage : alignement horizontal sur une ligne des boutons d’action entrepôt (Défaut, Renommer, Supprimer) avec icônes, coloration adoucie de la bannière Module Présence désactivé et statuts localisés en français dans la fiche présence.' },
      { id: '092f4', platforms: ['server', 'desktop', 'web'], text: 'Durcissement des sessions et déconnexions : schéma Authorization DPoP strict pour nv3., révocation côté serveur des jetons web à la déconnexion, contrôle atomique lors du rafraîchissement de rôle et garde de révocation d’appareil sur la boîte de confiance.' },
    ] }],
  },
  {
    version: '0.9.1',
    date: '22 novembre 2026',
    sections: [{ kind: 'features', items: [
      { id: '091f1', platforms: ['web', 'desktop', 'server'], text: 'Connexion desktop expérimentale en environnement de test : vérification de sécurité dans une fenêtre temporaire dédiée avant l’envoi du mot de passe saisi dans l’application, puis saisie native du code à usage unique.' },
      { id: '091f2', platforms: ['desktop', 'server'], text: 'Le serveur vérifie le défi et lie son résultat à la demande ; la fenêtre ne reçoit ni identifiants ni jetons de session. Expiration, annulation, usage unique et renouvellement de session restent contrôlés.' },
      { id: '091f3', platforms: ['desktop', 'server'], text: 'Un navigateur externe reste un choix explicite si la fenêtre temporaire ne fonctionne pas. Le pilote reste désactivé par défaut et réservé aux tests ; le client desktop doit encore intégrer ce parcours.' },
    ] }, { kind: 'improvements', items: [
      { id: '091ui8', platforms: ['web', 'server'], text: 'Produits : deuxième unité et coefficient facultatifs pour le marbre et le carrelage (par exemple 1 carton = 1,59 m²) ; le stock reste enregistré dans l’unité principale et son équivalent est affiché sur PC et mobile web.' },
      { id: '091ui7', platforms: ['web', 'server'], text: 'Rôles : actualisation de session côté web sans déconnexion lors d’un changement de rôle ; les anciens droits ne sont pas acceptés. Conversion de devis : stock et document sont mis à jour ensemble. Les créateurs connus des nouveaux documents apparaissent sans inventer les identifiants manquants.' },
      { id: '091ui6', platforms: ['web'], text: 'Comptes de l’équipe : création dans une fenêtre dédiée, avec des champs prévus pour un nouveau compte ; icônes Paramètres et À propos harmonisées.' },
      { id: '091ui5', platforms: ['web', 'server'], text: 'Produits : le prix de facture peut être configuré TVA incluse ou TVA ajoutée ; les ventes rapides restent sans TVA. Les demandes mobiles se limitent aux informations essentielles, sans prix.' },
      { id: '091ui1', platforms: ['web'], text: 'Catalogue PC : sélection et actions mieux disposées, cartes centrées et couleurs de stock ; accès aux modifications depuis la fiche produit. Les numéros de devis ouvrent leurs détails.' },
      { id: '091ui2', platforms: ['web', 'server'], text: 'Détails de vente rapide et de facture simplifiés, remboursement conservé dans les actions ; contraste du logo QR imprimé amélioré.' },
      { id: '091ui3', platforms: ['web', 'server'], text: 'Rapports TVA : les ventes rapides sont classées sans TVA ; les anciens montants enregistrés ne sont pas réécrits. Les devis convertis en vente rapide conservent leurs prix unitaires sans TVA ; les devis déjà payés exigent une régularisation préalable.' },
      { id: '091ui4', platforms: ['web', 'server'], text: 'Demandes mobiles de stock : l’utilisateur connecté qui les traite est enregistré comme approbateur du mouvement ; les identités absentes des anciens enregistrements restent inconnues.' },
      { id: '091ui9', platforms: ['web'], text: 'Nouveautés sur mobile : les plateformes concernées et les icônes des catégories suivent la présentation du journal sur ordinateur.' },
      { id: '091ui10', platforms: ['server', 'web'], text: 'Moteur financier Rust compilé en WebAssembly (ABI v2) : calculs des factures, achats, paiements, remboursements, remises et arrondis vérifiés à l’identique entre le serveur et l’interface web, avec contrôle strict au démarrage.' },
      { id: '091ui11', platforms: ['server', 'web'], text: 'Fiabilité et concurrence des écritures : clés d’idempotence sur les factures, achats, reçus et paies, protection contre les doubles paiements ou avances concurrentes, contrôle des imports/sauvegardes et corrélation des requêtes (X-Request-Id).' },
      { id: '091ui12', platforms: ['web'], text: 'Thème sombre, animations et aperçu d’images : élévations de surfaces et contrastes affinés sur ordinateur et mobile, micro-animations sur les bannières et cartes, visionneuse d’images avec zoom et attribution « Remerciements & contributeurs » / « Merci à » enrichie sur PC et mobile.' },
    ] }, { kind: 'fixes', items: [
      { id: '091c1', platforms: ['web', 'server'], text: 'Ventes rapides : aucun calcul de TVA, quel que soit le mode de prix des produits ; les anciennes ventes avec TVA enregistrée ne sont pas modifiées automatiquement.' },
      { id: '091c2', platforms: ['web', 'server'], text: 'Sessions : les anciens droits sont refusés après un changement de rôle et la session web peut être actualisée sans déconnexion. Les liens d’impression utilisent une autorisation distincte des rapports.' },
      { id: '091c3', platforms: ['web', 'server'], text: 'Conversion de devis : les mises à jour du document et du stock sont regroupées ; une erreur de stock ne laisse pas de conversion partielle.' },
      { id: '091c4', platforms: ['server', 'web'], text: 'Sécurité et précision numérique : normalisation stricte des nombres et montants négatifs, neutralisation des formules dans les exports CSV, limite de taille des requêtes API (2 Mo) et confidentialité des prix/coûts maintenue pour le rôle magasinier.' },
    ] }],
  },
  {
    version: '0.9.0',
    date: '19 novembre 2026',
    sections: [{ kind: 'improvements', items: [
      { id: '090i1', platforms: ['web'], text: 'Accueil mobile et balance : présentation mobile repensée, actions avec icônes, choix du mois et accès aux rapports ; la nouvelle écriture se remplit en deux étapes. Les chiffres viennent du serveur et les fonctions financières restent réservées aux rôles autorisés.' },
      { id: '090i2', platforms: ['web'], text: 'Navigation mobile : barre flottante, raccourcis, barre supérieure compacte et retours sur les pages secondaires. Profil, Agent, notifications et outils sont adaptés aux petits écrans.' },
      { id: '090i3', platforms: ['web'], text: 'Paramètres mobiles et Nouveautés mobiles : thème clair, sombre ou système, taille du texte, densité, animations, onglet d’ouverture et historique des versions en cartes. Les langues supplémentaires sont annoncées comme bientôt disponibles.' },
      { id: '090i4', platforms: ['web'], text: 'Rapports mobiles : lecture, zoom et enregistrement du PDF mensuel, partage selon le navigateur et pack personnalisable consultable dans Atlas, dans un aperçu isolé.' },
      { id: '090i5', platforms: ['web', 'server'], text: 'Produits sur mobile et PC : liste ou grille, ouverture de la fiche au toucher, remplacement de la photo principale pour les rôles autorisés et historique des mouvements. Sur mobile, création directe pour les administrateurs ou demande pour les autres rôles, recherche, filtres et actualisation séparée du catalogue et des demandes.' },
      { id: '090i6', platforms: ['web'], text: 'Chargement mobile : aperçus du tableau de bord, du catalogue, des alertes et de la balance ; les données du catalogue restent visibles pendant l’actualisation. Animations et transitions respectent la réduction des mouvements.' },
      { id: '090i7', platforms: ['web'], text: 'Connexion et scan mobiles : présentation mobile repensée, caméra à la demande, saisie manuelle et import d’image. Le scan d’appareil demande une confirmation avant toute approbation compatible.' },
      { id: '090i8', platforms: ['web'], text: 'Vente, notifications, profil et Agent mobiles : panier, demandes, discussion et raccourcis adaptés aux petits écrans ; réglages accessibles depuis le profil. La barre supérieure réduite reste stable au toucher et la navigation inférieure est masquée sur les écrans secondaires. La vente reste une demande à valider au PC.' },
      { id: '090i9', platforms: ['web'], text: 'Accueil et pages de téléchargement : présentation clarifiée, exemple de conversation remis dans l’ordre, captures web avec données fictives et animations adaptées à la réduction des mouvements.' },
      { id: '090i10', platforms: ['web'], text: 'Téléphone et bureau : présentation de l’équipe, contrastes sombres et barres flottantes améliorés ; les versions indiquent leur date de publication lorsqu’elle est disponible. Les journaux sont recherchables ; les docks bureau et Agent mobile se réduisent au titre au défilement et se rouvrent au toucher. Atlas Agent mobile est en plein écran avec historique local, nouvelle discussion, actualisation du contexte, quota IA, actions rapides en début de discussion et réponses mises en forme ; la conversation défile derrière son dock.' },
    ] }, { kind: 'fixes', items: [
      { id: '090s1', platforms: ['web'], text: 'Cookies et données locales, fenêtre Nouveautés, commandes et icônes : lisibilité corrigée pour les petits écrans et les thèmes clair et sombre.' },
      { id: '090s3', platforms: ['server', 'android', 'web'], text: 'Rapports financiers combinés : sections complètes — solde, stock, créances, dettes, employés, balance âgée et TVA — avec les données des rapports individuels ; le stock affiche tous les emplacements par défaut.' },
      { id: '090s4', platforms: ['server', 'android', 'web'], text: 'Accès aux rapports : tickets signés limités aux routes de rapport et au compte propriétaire ou administrateur, avec rôle actif vérifié et durée configurable plafonnée à 30 minutes. Les anciens liens doivent être rouverts avec un nouveau ticket.' },
      { id: '090s5', platforms: ['server', 'android', 'web'], text: 'Lecture et erreurs de rapport : pages générées sans JavaScript ni ressources externes, adaptées aux téléphones et à l’impression multipage. Tickets expirés, sections non prises en charge et échecs de génération produisent une erreur explicite ; vues à la demande sans archivage immuable.' },
      { id: '090s7', platforms: ['server', 'desktop', 'web'], text: 'Connexion desktop native : contrat et découverte v2 expérimentaux, désactivés par défaut ; le client desktop doit encore intégrer ce parcours. Approbation explicite par navigateur connecté avec QR contenant seulement une référence temporaire et code à comparer.' },
      { id: '090s9', platforms: ['server', 'desktop', 'web'], text: 'Sécurité v2 : liaison à l’origine HTTPS et au port, PKCE S256, expiration, annulation et échange atomique à usage unique ; limites persistantes par IP et compte, vérification de révocation et requêtes D1 vers la base primaire. Configuration du proxy et essais en environnement de test requis.' },
      { id: '090s11', platforms: ['server', 'desktop', 'web'], text: 'Compatibilité : les parcours web, Android et desktop v1 restent inchangés. Mot de passe/OTP natifs et passkeys Windows restent indisponibles sans garanties de sécurité vérifiables.' },
      { id: '090s15', platforms: ['server', 'web', 'android'], text: 'Employés et paie : contrôles serveur renforcés pour les rôles owner/admin ; paie personnelle et pointage provisoirement réservés aux administrateurs, et certaines anciennes impressions par ticket seul peuvent être indisponibles.' },
      { id: '090s16', platforms: ['server', 'web'], text: 'Départ d’un employé : la démission rend la fiche inactive sans créer de paiement ; suppression provisoirement bloquée en présence d’un historique de paiements.' },
      { id: '090s17', platforms: ['server'], text: 'Isolation des entreprises : sécurisation encore partielle, limitée au modèle existant d’une entreprise par base D1 ; l’isolation entre entreprises partageant une base n’est pas garantie et nécessite une décision d’architecture et des tests supplémentaires avant déploiement.' },
    ] }],
  },
  {
    version: '0.8.9',
    date: '15 novembre 2026',
    sections: [{ kind: 'features', items: [
      { id: '089s1', platforms: ['server', 'android'], text: 'API de suivi en lecture seule : demandes de stock personnelles et tickets GitHub associés aux signalements, avec lecture automatique pour les dépôts publics ; les dépôts privés nécessitent une activation explicite. Les sources indisponibles sont signalées explicitement.' },
      { id: '089s2', platforms: ['server', 'android'], text: 'Atlas Snake : synchronisation privée du meilleur score par compte, stockage initialisé automatiquement, sans classement et sans écraser un meilleur résultat.' },
      { id: '089s3', platforms: ['server', 'android'], text: 'Produits et mouvements : affichage des créateurs et approbateurs disponibles, sans inventer les identités manquantes.' },
      { id: '089s4', platforms: ['server', 'android'], text: 'Signalements : détection des répétitions exactes du même compte avant création, avec reçu et état de l’issue si vérifiable. Snake Android : progression locale isolée par empreinte du jeton, mode invité séparé et synchronisation du meilleur score avec statut et nouvelles tentatives limitées.' },
      { id: '089s5', platforms: ['server', 'android', 'web'], text: 'Images produits : orientation corrigée, recadrage carré et conversion WebP avant stockage ; migration progressive des images existantes à lancer par le propriétaire après sauvegarde. Les sources externes nécessitent une reprise manuelle.' },
      { id: '089s6', platforms: ['server', 'android'], text: 'Préférences Android : API privée par compte avec liste de réglages autorisés, versions et résolution des conflits, synchronisation planifiée et délai de cinq minutes entre synchronisations ; aucune donnée sensible ou consentement ne sont synchronisés. L’intégration Android reste à effectuer.' },
      { id: '089s7', platforms: ['server', 'web', 'android', 'desktop'], text: 'Documentation rationalisée : guides de connexion, finance, notifications et interface regroupés ; anciennes consignes destinées aux agents supprimées, avec conservation des informations opérationnelles utiles.' },
    ] }],
  },
  {
    version: '0.8.5',
    date: '13 novembre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '085s1', platforms: ['server'], text: 'Réplication globale D1 (Sessions API) : routage optimisé des lectures sur réplicas avec maintien strict de la cohérence séquentielle (read-your-writes) via jetons de reprise (x-d1-bookmark / cookie).' },
          { id: '085s2', platforms: ['server'], text: 'Sécurité et intégrité des sessions : routage systématique sur la base primaire (first-primary) pour les routes d’authentification, d’administration, d’approbation et de mutation métier sans affaiblir les contrôles de sécurité.' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '085s3', platforms: ['server'], text: 'Contrôles d’accès aux écritures : verrouillage strict des mutations clients et tarifs de gros via requireBizMutator et vérification dynamique des rôles sur la table app_users.' },
          { id: '085s4', platforms: ['server'], text: 'Sécurité des flux et données sensibles : protection contre l’exécution d’outils sur flux IA interrompus, minimisation des champs exposés par rôle, masquage des invites dans les journaux d’audit et chiffrement fail-closed.' },
          { id: '085s5', platforms: ['server'], text: 'Normalisation réseau : prise en charge et normalisation rigoureuse des adresses IPv4 et IPv6 (avec ports ou crochets) dans la réputation IP et la résolution client.' },
        ],
      },
    ],
  },
  {
    version: '0.8.1',
    // Date of the merged 0.8.1 change set, not the browser's current date.
    date: '11 novembre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '081s1', platforms: ['server'], text: 'Connexion Android : préparation d’une preuve de possession cryptographique liée au compte et au serveur, plutôt qu’à la seule empreinte de l’appareil. Ce mécanisme reste désactivé, en attente de revue de sécurité et d’intégration Android ; les règles actuelles de mot de passe et d’OTP sont inchangées.' },
          { id: '081s2', platforms: ['server'], text: 'Sécurité de la connexion : 82 tests backend supplémentaires couvrent la séparation des comptes, les preuves absentes ou invalides, l’expiration, la révocation, le repli OTP, les changements d’IP avec un VPN, les limites de tentatives sur IP partagée et les mots de passe incorrects. Ces tests ne remplacent pas une validation sur un appareil Android réel.' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '081s4', platforms: ['server'], text: 'Connexion sur VPN et réseaux partagés : les limites de tentatives distinguent désormais les comptes et les usages, avec des compteurs persistants et des plafonds globaux par IP. Quelques échecs sur un autre compte ne dégradent plus automatiquement la réputation de toute l’IP ; les blocages explicites et les protections contre les tentatives massives restent appliqués.' },
          { id: '081s5', platforms: ['server'], text: 'Vérification par code ou lien e-mail : le compte demandé doit correspondre au contexte de connexion et les deux méthodes partagent le même budget de tentatives OTP. Les refus pour trop de tentatives indiquent un délai avant de réessayer ; une indisponibilité du limiteur ne permet pas de contourner la vérification.' },
          { id: '081s6', platforms: ['server'], text: 'Validation de connexion : tests locaux avec deux comptes de test derrière une même IP simulée, sans suppression de l’OTP. Le guide distingue 429 RATE_LIMITED de 503 AUTH_LIMIT_UNAVAILABLE et rappelle qu’une ancienne IP bloquée nécessite une revue ciblée. La validation en staging isolé reste à effectuer ; aucun compte à rebours ni nouvelle tentative automatique n’est ajouté à Android.' },
          { id: '081s3', platforms: ['web'], text: 'Nouveautés : la page et la fenêtre de mise à jour affichent les notes de la version publiée correspondante. Une simple modification du numéro de build ne représente plus les anciennes notes comme une nouvelle mise à jour.' },
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    date: '6 novembre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '080s1', platforms: ['server'], text: 'Atlas Agent : le streaming conserve les outils métier autorisés et transmet désormais les propositions d’actions dans la réponse finale, avec les traces d’outils et les métadonnées utiles aux clients Android. Une proposition ne vaut pas validation automatique.' },
          { id: '080s2', platforms: ['server'], text: 'Connexion mobile : la déconnexion authentifiée confirme si la reprise a été préparée. Le mot de passe reste requis ; l’OTP reste obligatoire sans reprise valide ou avec la 2FA activée.' },
          { id: '080s4', platforms: ['web'], text: 'Bienvenue : les captures de démonstration sont présentées une par une, dans des étapes séparées avec Précédent / Suivant, plutôt qu’une longue galerie sur une seule page.' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '080s3', platforms: ['server'], text: 'Sécurité de la reprise : le marqueur du même compte et du même appareil est consommé atomiquement, pour empêcher sa réutilisation par deux connexions simultanées.' },
        ],
      },
    ],
  },
  {
    version: '0.7.9',
    date: '5 novembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '079s1', platforms: ['server'], text: 'Demandes d’ajustement de stock : notification push aux responsables autorisés à la soumission, puis au demandeur après approbation ou refus. Les notifications restent génériques, sans données sensibles ; un échec d’envoi ne bloque pas la demande et les actions répétées ne renvoient pas de notification.' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '079s2', platforms: ['server'], text: 'Atlas Agent : les réponses en streaming peuvent désormais utiliser les mêmes outils métier et le savoir enregistré que les réponses classiques, avec les mêmes permissions et une trace des outils utilisés.' },
          { id: '079s3', platforms: ['web'], text: 'À propos : les cartes Support et Hébergement sont centrées côte à côte sur grand écran et empilées sur mobile.' },
          { id: '079s4', platforms: ['server'], text: 'Connexion : 7 tests de régression supplémentaires protègent la reprise sans OTP après une déconnexion volontaire, uniquement pour le même compte et le même appareil, sans contourner les contrôles de sécurité.' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '079s5', platforms: ['server'], text: 'Avatars : un cache vide est traité normalement et recharge l’image d’origine, sans faux 404 interne. Base de données : les migrations vérifient les colonnes existantes avant de les ajouter, évitant les erreurs répétées de colonne déjà présente dans les journaux Cloudflare.' },
        ],
      },
    ],
  },
  {
    version: '0.7.5',
    date: '2 novembre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '075s1', platforms: ['web', 'server'], text: 'Comptes : se déconnecter soi-même ne redemande plus d’OTP au retour (même compte, même appareil, 30 jours) et le menu compte permet de basculer entre comptes enregistrés — comme sur l’app Android — ou d’« Ajouter un compte »' },
          { id: '075s2', platforms: ['web', 'server'], text: 'Atlas Agent : mémoire et savoir persistants, appel de vrais outils en conversation, onglet dédié dans les Paramètres (permissions en popup, accès utilisateurs, verrouillage expliqué en cas de suspension)' },
          { id: '075s3', platforms: ['web'], text: 'Recherche globale : panneau latéral animé qui cherche vraiment partout (pages, produits, clients, factures), historique enregistré sur l’appareil, un seul bouton recherche sur toutes les barres' },
          { id: '075s4', platforms: ['web', 'desktop'], text: 'Pages publiques repensées : accueil vitrine du produit (arc « Un dossier. Tout votre commerce. »), /desktop avec les installateurs bureau officiels, /android avec l’APK réel lu du manifeste R2, QR code au logo Atlas' },
          { id: '075s5', platforms: ['web'], text: '« Page d’ouverture » au choix par appareil (appliquée à la connexion) et connexion par QR depuis les Paramètres (le PC affiche Accepter / Refuser après le scan du téléphone)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '075s6', platforms: ['web'], text: 'Barre du haut unifiée partout (accueil, Paramètres, À propos, Nouveautés) : pilule flottante toujours visible, compacte au scroll sans scintillement ; chip compte avec vrai nom, rôle en français, avatar et menu déroulant' },
          { id: '075s7', platforms: ['web'], text: 'Paramètres rangés : bloc « Sécurité du compte » (appareils connectés, 2FA, suppression) dans Profil, « Modifier le profil » seulement dans le premier onglet, « Page d’ouverture » et guide d’accueil réservés à l’onglet Admin' },
          { id: '075s8', platforms: ['web'], text: 'Thème clair/sombre cohérent (zinc + terracotta) sur toutes les pages — À propos, Nouveautés, /android, /desktop, filtres et puces lisibles — avec thème « système » par défaut au premier lancement' },
          { id: '075s9', platforms: ['web', 'server'], text: 'Connexion améliorée : passkey et « Télécharger l’app Android » en vrais boutons, identifiants pré-remplis lisibles, « Réessayer la vérification » si Turnstile bloque, fin du faux « Appareil révoqué » en changeant de compte, responsive complet (pliables, tablettes)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '075s10', platforms: ['web', 'server'], text: 'Correctifs : le QR ne bloque plus sur « En attente du scan… », révoquer un appareil coupe aussitôt sa session, /dashboard ne fige plus l’onglet, /login connecté mène à la page d’ouverture, patrol sécurité sans CRITICAL trompeur, formulaire employés simplifié' },
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
          { id: '063a2', platforms: ['desktop'], text: 'Référence historique des choix visuels desktop, web et Android : couleurs, rayons, typographie, densités, mouvement, composants et vérifications dans src/components/ui/README.md.' },
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

export const KIND_META: Record<
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
  const [contributors, setContributors] = useState<Contributor[]>(REPO_CONTRIBUTORS);
  const [contribLoading, setContribLoading] = useState(true);

  useEffect(() => {
    markWhatsNewSeen();
    let alive = true;
    fetchRepoContributors()
      .then((list) => {
        if (alive) setContributors(list);
      })
      .finally(() => {
        if (alive) setContribLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const releases = useMemo(() => {
    // v0.7.5 — journal public : tout ce qui suit 0.7.2 est regroupé sous 0.7.5 (cap).
    return RELEASES.filter((r) => semverAtMost(r.version, RELEASE_VISIBLE_CAP)).map((rel) => ({
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
      <motion.h1
        className="wn-title"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Nouveautés
      </motion.h1>

      <motion.section
        className="wn-thanks-card"
        aria-label="Remerciements et contributeurs"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04, duration: 0.3 }}
      >
        <div className="wn-thanks-head">
          <span className="wn-thanks-ico" aria-hidden="true">
            <Users size={16} strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="wn-thanks-title">Remerciements &amp; contributeurs</h2>
            <p className="wn-thanks-sub">
              Merci à toutes les personnes qui ont contribué par leurs commits et améliorations à Atlas Commerce :
            </p>
          </div>
        </div>
        <div className="wn-contributors">
          {contributors.map((c, idx) => (
            <a
              key={c.login}
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
              className="wn-contributor-pill"
              style={{ animationDelay: `${Math.min(idx * 45, 240)}ms` }}
              title={`${c.name} — ${c.role}`}
            >
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" />
              ) : (
                <span className="wn-contributor-fallback" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="wn-contributor-name">{c.name !== c.login ? `${c.name} (${c.handle})` : c.handle}</span>
            </a>
          ))}
          {contribLoading && (
            <>
              <span className="skeleton ac-skeleton-pill" style={{ width: 124 }} aria-hidden="true" />
              <span className="skeleton ac-skeleton-pill" style={{ width: 112 }} aria-hidden="true" />
            </>
          )}
        </div>
      </motion.section>

      <div className="wn-releases">
        {releases.map((rel, ri) => {
          const relContributors = getContributorsForRelease(rel.version);
          return (
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
            <div className="wn-release-contributors" aria-label={`Contributeurs de la version ${rel.version}`}>
              <span className="wn-contributors-label"><Heart size={13} strokeWidth={2.2} aria-hidden="true" /> Merci à</span>
              {relContributors.map((c) => (
                <a
                  key={`${rel.version}-${c.login}`}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="wn-contributor-pill"
                  title={`${c.name} (${c.handle})`}
                >
                  {c.avatarUrl ? (
                    <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" />
                  ) : (
                    <span className="wn-contributor-fallback" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="wn-contributor-name">{c.handle}</span>
                </a>
              ))}
            </div>
          </motion.section>
          );
        })}
        {releases.length === 0 && (
          <p className="wn-lead">Aucun élément pour ce filtre.</p>
        )}
      </div>
    </div>
  );
}
