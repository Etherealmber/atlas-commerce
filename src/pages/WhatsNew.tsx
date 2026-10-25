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
    version: '0.6.2-beta',
    date: '26 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '062a1', text: 'Rapports sur un mois précis : /api/reports/combined et ses sections acceptent désormais une période AAAA-MM strictement validée (année 1970–2100, mois 01–12 — toute valeur invalide retombe sur le mois en cours, jamais de dates cassées) en plus des périodes relatives (ce mois, 3/6/9/12 mois, 2–4 ans, année civile, personnalisé) ; sélecteur de mois dans Solde (input type=month) à côté des périodes rapides' },
          { id: '062a2', text: 'Périodes ancrées sur le fuseau finance de l’entreprise (company_settings.finance_timezone, défaut Africa/Casablanca) : le mois en cours s’arrête à AUJOURD’HUI dans ce fuseau (plus le jour UTC du serveur), les mois passés utilisent le mois complet (février bissextile inclus), le mois futur est borné proprement ; la période choisie est propagée à toutes les sections et à tous les liens du rapport combiné (rt + période normalisée — l’entrée brute n’est jamais recopiée)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '062a3', text: 'Sécurité rapports inchangée et renforcée : les liens profonds gardent le ticket HMAC rt courte durée (30 min) — jamais de JWT de session accepté ni exposé dans les liens (le paramètre token est supprimé défensivement) ; la synthèse Solde du rapport combiné est maintenant bornée par la période sélectionnée ; logique extraite dans worker/lib/report-period.ts (pure, testable) — 17 nouveaux tests (mois valides/invalides, bornes de fuseau Tokyo/UTC/Casablanca sans offset figé, mois courant partiel, mois historiques bissextiles, propagation rt+période) — vitest 112/112' },
        ],
      },
    ],
  },
  {
    version: '0.6.1-beta',
    date: '26 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '0510a1', text: 'Passkeys Android : le vérificateur accepte désormais LES DEUX formats d’origine natifs documentés — android:apk-key-hash-sha256: (émis par Credential Manager) ET le préfixe historique android:apk-key-hash: (base64 du SHA-1 du certificat, documenté par la stack FIDO2 d’Android) via WEBAUTHN_ANDROID_CERT_SHA1 optionnel ; la comparaison est octet par octet après décodage tolérant (base64 standard ou url-safe, avec ou sans remplissage) — plus aucun échec WEBAUTHN_BAD_ORIGIN dû à une simple différence d’encodage ou de préfixe' },
          { id: '0510a2', text: 'GET /api/auth/webauthn/status expose data.android.origin_legacy à côté de data.android.origin : l’app et l’APK comparent exactement ce que le backend accepte avant d’afficher les passkeys ; 4 nouveaux tests (dérivation SHA-1, acceptation multi-encodages, rejet sans empreinte SHA-1, connexion native legacy) — vitest 95/95' },
        ],
      },
    ],
  },
  {
    version: '0.5.9-beta',
    date: '26 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '059a1', text: 'Crash reporting automatique : les plantages de l’application (erreurs globales, promesses rejetées, crashs d’écrans React) sont capturés, assainis (secrets et tokens retirés, adresse IP hachée), dédupliqués par empreinte — un bug = une seule issue — puis envoyés directement dans les issues GitHub du projet ; sans token configuré, tout est gardé en file et part automatiquement dès sa configuration (cron quotidien inclus), aucun rapport n’est perdu' },
          { id: '059a2', text: 'Signalement utilisateur : À propos → « Signaler un problème » — bug, idée ou question, avec contact facultatif ; chaque message devient une issue GitHub avec sa référence (R-…), sans que l’utilisateur ait besoin d’un compte GitHub' },
          { id: '059a3', text: 'Panneau propriétaire Paramètres → Intégrations → « Rapports & crashs → GitHub » : collez un token fine-grained (Issues en lecture/écriture — gratuit, github.com/settings/personal-access-tokens/new), il est validé contre GitHub avant stockage et n’est jamais renvoyé ; dépôt cible modifiable, file d’attente visible, renvoi manuel, crashs et signalements récents avec liens vers les issues' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '059a4', text: 'Documentation reprise de zéro : SETUP.md — installation complète du premier départ (comptes gratuits, base de données D1, cache KV, stockage R2, chaque secret avec le lien de son fournisseur : Groq, Google AI Studio, Resend, Turnstile, Firebase, GitHub — déploiement 100 % navigateur sans CLI via Workers Builds, domaine personnalisé, e-mail OTP, vérification, passkeys et app Android) ; docs/reports-github.md (confidentialité, déduplication, endpoints) ; README corrigé (Capacitor supprimé, index à jour) ; nettoyage de 7 fichiers d’état obsolètes' },
        ],
      },
    ],
  },
  {
    version: '0.5.8-beta',
    date: '25 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '058a1', text: 'Passkeys Android (Credential Manager) : le vérificateur accepte désormais l’origine native android:apk-key-hash-sha256 dérivée de l’empreinte SHA-256 du certificat de signature Play configuré côté serveur, ainsi que l’origine web en mode cross-origin quand le paquet Android signé correspond — sans configuration Android, tout reste strictement web (origine exacte, crossOrigin rejeté)' },
          { id: '058a2', text: 'WEBAUTHN_ANDROID_PACKAGE préconfiguré (ma.etherealmber.atlascommerce) ; GET /api/auth/webauthn/status expose data.android.origin — la valeur exacte acceptée par le backend, à comparer avec celle produite par l’APK signé Play ; /.well-known/assetlinks.json s’active automatiquement dès que l’empreinte du certificat est renseignée (Play Console → Setup → App integrity)' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '058a3', text: '6 nouveaux tests d’intégration Android (dérivation de l’origine apk-key-hash, enregistrement/connexion natifs acceptés, paquet inconnu ou certificat non configuré rejetés, matrice cross-origin) — suite vitest 78/78 ; docs/webauthn.md §4a : matrice complète des origines acceptées' },
        ],
      },
    ],
  },
  {
    version: '0.5.7-beta',
    date: '25 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '057a1', text: 'Passkeys (WebAuthn) : vérification cryptographique complète côté serveur — challenge aléatoire à usage unique (atomique, 5 minutes, lié au compte, au RP et à l’origine), type webauthn.create/get vérifié, origine exacte autorisée, hash RP ID, flags présence/verification utilisateur, attestation « none » uniquement, clé publique ES256 extraite de l’objet d’attestation et stockée, signature vérifiée sur authData + hash clientData, handle utilisateur obligatoirement égal au compte (un passkey d’un autre compte est rejeté), compteurs anti-rejeu avec règle des passkeys synchronisés, doublons refusés, inscription liée à la session active' },
          { id: '057a2', text: 'Capacité passkeys exposée aux clients : GET /api/auth/webauthn/status — l’app et l’APK n’affichent les passkeys QUE si le serveur les a activées de façon sécurisée (enabled, rp, origines, user_verification, ES256, état Android) ; Android Credential Manager : /.well-known/assetlinks.json servi automatiquement dès que le package et l’empreinte SHA-256 de signature Play sont configurés (docs/webauthn.md §4)' },
          { id: '057a3', text: 'Audit miroir automatique (finance) : chaque réponse mensuelle et chaque relevé embarque mirror_audit — lignes miroir exclues comparées aux tables bill_payments/employee_payments avec drapeau consistent ; la vérification du correctif 6 000 MAD tourne toute seule en production, à chaque requête, sans CLI ni PC' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '057a4', text: 'Sécurité passkeys : avant cette version, les routes WebAuthn faisaient confiance aux champs soumis par le client (aucune vérification de signature, clé publique jamais stockée, token émis après simple consommation du challenge + lookup de l’identifiant, challenges liés à une empreinte fournie par le client et consommation non atomique) — vecteur de prise de compte ; désormais chaque succès exige la vérification complète, les anciennes lignes sans clé publique sont inertes, et tout échec de connexion renvoie un code générique unique (401 WEBAUTHN_VERIFY_FAILED) qui rend l’énumération de comptes impossible' },
          { id: '057a5', text: 'Passkeys volontairement DÉSACTIVÉES en production (WEBAUTHN_ENABLED=false — les 4 routes répondent 503 WEBAUTHN_DISABLED) jusqu’à validation de la checklist de déploiement docs/webauthn.md §5 ; 27 nouveaux tests WebAuthn (signatures ES256 réelles, fixtures CBOR, replay, origines, flags, compteurs, politiques) — suite vitest 72/72' },
        ],
      },
    ],
  },
  {
    version: '0.5.6-beta',
    date: '24 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '056a1', text: 'Relevé mensuel de trésorerie côté serveur : GET /api/admin/finance/statement (owner/admin) — solde d’ouverture, mouvements chronologiques (encaissements, remboursements, dépenses, paie, fournisseurs) avec solde courant ligne à ligne, références assainies (numéros de documents, jamais de données personnelles), totaux, pagination, statut mois ouvert/clos et contrôle d’exactitude ouvrant + crédits − débits = clôturant ; le relevé, le résumé mensuel et le PDF partagent désormais UN SEUL calcul canonique' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '056a2', text: 'Finance : fin du double comptage des paiements fournisseur et des salaires — chaque paiement écrivait une ligne miroir dans les dépenses (journal de Solde) que le calcul mensuel re-soustrayait : un règlement de 6 000 MAD apparaissait comme dépense fantôme ET trou de 6 000 MAD dans la clôture ; les avoirs (« Avoir … ») gonflaient aussi les encaissements ; correction rétroactive de toutes les périodes, sans supprimer aucune donnée, avec tests de régression (doublons visibles, annulations, frontières de fuseau, isolation société)' },
          { id: '056a3', text: 'Finance : les paiements facture/achat datés par défaut au jour LOCAL du tenant (Africa/Casablanca) au lieu du jour UTC — un encaissement saisi juste après minuit tombait dans le mois précédent' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '056a4', text: 'Chargement plus rapide : Smart Placement (le worker tourne près de sa base D1 — chaque requête API économise un aller-retour inter-régional) + en-têtes de cache immuables pour les bundles hashés (public/_headers) ; le cache edge des avatars est réactivable sans risque (toutes les réponses JSON privées restent no-store)' },
        ],
      },
    ],
  },
  {
    version: '0.5.5-beta',
    date: '24 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '055a1', text: 'Le téléphone devient le jumeau de l’app Android : même barre du haut (titre de l’onglet, sous-titre nom · rôle, menu rapide rond à chevron avec badge notifications, avatar qui ouvre le profil), même barre d’onglets à 5 places (Accueil, Produits, Scan, Vente avec badge panier — masquée pour les rôles sans caisse, Agent) et même accueil que l’APK : héros dégradé sombre adapté au rôle (ventes du jour ou pilotage catalogue & stock), boutons Nouvelle vente / Scanner + Produits, carte Info Box avec puce Ouvrir, tuiles de statistiques à icônes et tons (produits, ventes, stock faible, envois en attente), alerte stock dédiée, raccourcis entrepôt/achats/devis — palette zinc-papier-safran, coins 8 à 24 px, typographie et espacements compacts repris à l’identique du Material 3 natif' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '051d17', text: 'Le téléphone retrouve son VRAI espace optimisé : l’app terrain /m (scan d’abord, catalogue hors-ligne, barre d’onglets) se relance automatiquement sur les petits écrans, l’APK native et ?mode=phone — le PC garde l’ERP complet. Passé confort tactile : cibles 44px+, anti-zoom iOS sur les champs, plus de texte sélectionnable sur les boutons, ripple matériau au toucher (React Bits), chiffres animés (CountUp) et loupe Lens sur les images. Qualité : oxlint branche le radar à bugs (0 erreur, 23 vrais défauts corrigés) dans la CI' },
          { id: '051d18', text: 'Finance côté serveur, sûre par rôle : rapport mensuel de trésorerie calculé par le worker (soldes ouverture/clôture, encaissements, dépenses, remboursements, créances clients et dettes fournisseurs échues/en retard, paie due) réservé owner/admin, PDF mensuel généré à la demande (jamais stocké ni devinable, téléchargement journalisé), échéancier de paie paginé sans données personnelles, et rappels programmés non spammeurs (jours 1/2/3 : rapport prêt puis seulement les changements ; factures clients et fournisseurs échues, paie due, paiement client enregistré) avec anti-doublon durable en base, revérification du rôle à l’envoi, retries avec backoff et montants masqués sur l’écran de verrouillage si réglé' },
          { id: '055a2', text: 'Historique des nouveautés réorganisé : l’énorme liste de la 0.5.1 est répartie en versions lisibles (0.5.1 allégée, puis 0.5.2 Avatars & agent, 0.5.3 Base de données, 0.5.4 Sécurité & CI) — aucun contenu supprimé, mêmes identifiants ; la version courante passe à 0.5.5-beta' },
          { id: '055a5', text: 'Paie : chaque employé peut voir SA date de paie — nouveau point API GET /api/me/payroll strictement limité à sa propre fiche (liaison par identifiant de connexion, champ « Compte lié » sur la fiche employé, configurable par l’admin) ; jamais les données des autres, réponse claire si aucune fiche n’est liée' },
          { id: '055a6', text: 'Push Android : le pont FCM complet est livré (correctif prêt à appliquer + guide pas à pas dans docs/) — SDK Firebase Messaging, service de réception, canal « Assistant & notifications serveur », enregistrement automatique du jeton d’appareil à chaque connexion pour que les notifications du serveur (agent, paie, stock) atteignent enfin l’APK' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '055a3', text: 'Agent Atlas : cliquer/taper sur une image jointe l’ouvre désormais en plein écran — la visionneuse n’était plus piégée dans le panneau de l’agent (correctif portail), sur les vignettes envoyées comme sur les puces en cours de composition' },
          { id: '055a4', text: 'Agent Atlas : les images jointes survivent au rafraîchissement de la page — photos recompressées (≤1280 px) puis enregistrées avec la conversation (local + serveur), pièces jointes non envoyées restaurées après rechargement, repli propre si le quota de stockage est atteint' },
          { id: '055a7', text: 'Nouveau produit : la photo ajoutée dans l’assistant se modifie avant création — bouton ✎ sur chaque photo déposée (outil de recadrage complet, le même qu’en modification), la version recadrée est celle envoyée au catalogue' },
        ],
      },
    ],
  },
  {
    version: '0.5.4-beta',
    date: '23 octobre 2026',
    sections: [
      {
        kind: 'improvements',
        items: [
          { id: '051d7', text: 'Assistants : plus aucune pastille d’étapes en haut (le chip « Étape X/Y » du pied suffit), plus de défilement même sur fenêtre étroite (2 colonnes gardées dans les modales) ; vente rapide sans double champ code-barres/SKU ; zone OCR compacte sans bouton « Choose File » natif (glisser-déposer réel) ; mode sombre : cartes Solde/fournisseurs, bouton « Arrêter » de l’agent, pastilles « Aller à », indicateur Réflexion et toggle mot de passe enfin thémés, et aucun bouton ne devient blanc au tap/focus' },
          { id: '051d8', text: 'Trois gardes CI sur chaque pull request : API (TypeScript worker vs baseline + dry-run wrangler, rien n’est déployé par la CI), frontend (build Vite + sanity du bundle + TypeScript src vs baseline), et thèmes/CSS (structure des feuilles de style, dark-force.css dernier import, aucune nouvelle couleur blanche en mode sombre) — un PR rouge ne peut plus atteindre la production' },
          { id: '051d10', text: 'Pipeline de release Android sans aucun upload manuel : GitHub Actions POSTe l’APK signé sur /api/admin/android-release (Bearer), le worker le streamme vers R2/CDN1 (version immuable + latest.apk + latest.json no-cache), l’app lit /api/app/android-update et les pings HEAD /app-updates/* répondent via bucket.head() — tests vitest inclus et lancés par la CI' },
          { id: '051d11', text: 'Automatisation GitHub : patrouille de sécurité quotidienne qui « tente de pirater » le site (SQLi, XSS, traversal, Log4Shell, accès admin non authentifié), compte les intrusions réelles bloquées par le WAF et ouvre un ticket avec les correctifs possibles ; triage automatique des tickets (plainte, bug, sécurité, idée) avec accusé de réception ; formulaires de tickets structurés ; et auto-merge des PR uniquement quand TOUS les contrôles CI sont verts' },
          { id: '051d15', text: 'Entretien automatique du dépôt : les branches fusionnées ou dont la PR est fermée sont supprimées (à la fermeture + balayage hebdomadaire, jamais une branche avec PR ouverte ni non fusionnée), et la patrouille peut purger elle-même le cache Cloudflare et nommer la règle pare-feu qui la bloque si un jeton CF_API_TOKEN est fourni' },
          { id: '051d16', text: 'Nouveau design des e-mails OTP (maquette fournie adoptée telle quelle : en-tête logo, tag saumon, grand titre avec italique, boîte de code, bouton orange pleine largeur, pied noir avec réseaux sociaux) et vérification en UN tap : le bouton ouvre /verify qui transmet le code tout seul au worker (lien signé, usage unique), détecte la PWA installée ou l’app Android native et lui passe la main directement — plus aucun code à recopier' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '051d12', text: 'Premier rapport de la patrouille corrigé à la racine : /api/health et /api/canary redeviennent publics (la sonde pré-login du sélecteur de serveur Android répondait 401), et la patrouille v2 distingue le WAF du worker de l’edge Cloudflare, lit les corps JSON (un 200 « success:false » est bien un refus), détecte les fuites de cache edge sur /api/* et ne se fait plus piéger par ses propres en-têtes' },
          { id: '051d13', text: 'Anti-fuite de cache edge : toutes les réponses /api non explicitement publiques renvoient désormais Cache-Control no-store + CDN-Cache-Control no-store — plus aucun listing authentifié ne peut être rejoué anonymement par le cache Cloudflare (finding réel de la patrouille) ; la patrouille v3 reconnaît HIT/STALE/EXPIRED/REVALIDATED et identifie la couche exacte (worker, edge, cache) dans chaque finding' },
          { id: '051d14', text: 'La patrouille a trouvé une vraie faille critique et elle est corrigée : un appelant SANS jeton (ou avec un jeton forgé en base64) était traité comme « owner » sur 58 routes API enregistrées avant le middleware d’authentification (admin/users, admin/config, admin/audit, r2/images, db-migrate…). Le middleware d’authentification est désormais enregistré AVANT toutes les routes (vérification HMAC + IP/appareil pour tout le monde), l’anonyme reste anonyme, le flux de connexion QR continue de fonctionner, et la patrouille rejoue l’attaque (jeton forgé) à chaque passage pour garantir que la porte reste fermée' },
        ],
      },
    ],
  },
  {
    version: '0.5.3-beta',
    date: '23 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '051d4', text: 'Corruption D1 (« database disk image is malformed » / SQLITE_CORRUPT) reconnue : message clair « base corrompue, restauration Cloudflare requise » (code DB_CORRUPT) au lieu d’un « Erreur interne » générique sur tout le site' },
          { id: '051d5', text: 'Auto-réparation de l’index de recherche produit (FTS5) : en cas de corruption (SQLITE_CORRUPT_VTAB), l’index est reconstruit depuis products — ou recréé et re-rempli — sans aucune perte de données, puis l’action n’a qu’à être réessayée ; bouton de reconstruction manuel réservé owner/admin' },
          { id: '051d6', text: 'Réplication de lecture D1 (Sessions API) branchée automatiquement : chaque requête ouvre une session D1 (cookie de bookmark pour relire ses propres écritures), les lectures peuvent être servies par la réplique la plus proche — et une sonde d’intégrité FTS tourne en tâche de fond (≤1/5 min) pour réparer sans aucune action manuelle' },
          { id: '051d9', text: 'E-mails entrants : le worker accepte de nouveau les événements Email Routing (export email()) au lieu de crasher « Handler does not export an email() function » — réponse, bounce ou OTP revenu par une règle catch-all : une ligne de journal puis consommation silencieuse ; l’envoi OTP passe toujours par Resend en premier' },
        ],
      },
    ],
  },
  {
    version: '0.5.2-beta',
    date: '22 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '052a1', text: 'Atlas Agent lit chaque fichier DÈS l’envoi (images en vision, extraits texte inclus dans le prompt) ; dire « lis ça » sans joindre de fichier reprend automatiquement le dernier fichier envoyé' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '053b1', text: 'Avatar instantané : cache blob en mémoire partagé par toute l’app (un seul téléchargement par session), cache Durable Object + cache edge côté worker, et préchargement dès l’ouverture de session — fini l’attente sur le cercle vide' },
          { id: '053b2', text: 'Avant l’arrivée de la photo, le monogramme/initials s’affiche immédiatement (plus jamais de cadre vide)' },
          { id: '053b3', text: 'Avatars recadrés encodés en WebP (~3× plus léger que JPEG) : upload et chargement plus rapides' },
          { id: '054b1', text: 'Aucun assistant ne défile : l’étape « Prix & stock » du produit est scindée (étape dédiée « Remises volume ») — audit complet de tous les wizards (Devis, Employés, Clients, Factures, Vente rapide, Achats, Fournisseurs, Solde, Remboursement) : chaque étape statique tient à l’écran, seules les listes de lignes dynamiques défilent sous le pied fixe' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '052c4', text: 'Contours d’images thématisés (fini le liseré noir en mode clair / blanc en mode sombre) + fond neutre sous les PNG transparents' },
          { id: '052c5', text: 'Historique des versions entièrement renuméroté en 0.x : l’ancien cycle 1.x devient 0.0.1 → 0.4.4 (première version = 0.0.1), plus aucune étiquette 1.x ni doublon' },
          { id: '055c1', text: '« Erreur interne » sur l’enregistrement produit : la colonne updated_at est désormais gardée comme les autres, le contrôle de doublon ne peut plus faire échouer la sauvegarde, et la cause exacte est journalisée côté serveur ; le service worker passe en v11 — les vieux caches production (qui resservaient l’ancien JS) sont purgés' },
          { id: '055c2', text: 'Appareils connectés : chaque appareil actif du compte (PC, téléphone) s’enregistre automatiquement et apparaît dans la popup, appareil courant marqué « current »' },
          { id: '055c3', text: 'Agent : un message avec pièces jointes n’affiche plus aucun texte parasite (« Voir les pièces jointes [Pièces jointes: …] ») — pastilles propres avec le nom du fichier, dans les deux thèmes' },
          { id: '055c4', text: 'Mode sombre : boutons copier/× des messages et ✎/✕ des pièces jointes enfin visibles (encre constante, survols thémés)' },
          { id: '051d1', text: 'Nouveau produit : la zone d’upload des photos existe dès l’étape Photos de l’assistant de création (glisser-déposer ou parcourir, aperçus avec suppression) — les images choisies partent automatiquement juste après la création' },
          { id: '051d2', text: 'Photo de profil visible immédiatement après un rafraîchissement : topbar, menu utilisateur et réglages se mettent à jour dès que le profil arrive, sans aucun clic' },
          { id: '051d3', text: 'Facture : si la déduction de stock échoue (erreur base de données), la facture est annulée et l’erreur réelle s’affiche dans la zone prévue — plus jamais de stock faussé en silence' },
        ],
      },
    ],
  },
  {
    version: '0.5.1-beta',
    date: '22 octobre 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: '0411a1', text: 'Glisser-déposer réel des photos produit : déposez vos images directement sur l’étape Photos (zone en pointillés pleine largeur, surbrillance cuivre pendant le glisser), ou cliquez pour parcourir' },
        ],
      },
      {
        kind: 'improvements',
        items: [
          { id: '0411b1', text: 'Assistant produit allégé : l’étape « Variantes & photos » est séparée en deux étapes dédiées (Étape 3 Variantes · Étape 4 Photos) — moins de contenu d’un coup, moins de défilement' },
          { id: '0411b2', text: 'Pied d’assistant réellement fixe dans toutes les fenêtres : les boutons ne bougent plus et ne recouvrent jamais le contenu — le corps de l’étape défile à l’intérieur, la barre reste en bas' },
          { id: '0411b3', text: 'L’assistant repart toujours à l’étape 1 à chaque ouverture (nouveau produit, modification, pré-remplissage scan/agent)' },
          { id: '0411b4', text: 'Assistant produit en 5 étapes (Identité · Classement · Prix & stock · Variantes · Photos) : chaque étape tient à l’écran sans défilement' },
          { id: '0411c1', text: 'Menu utilisateur du topbar ouvert dans un portail fixé sous le bouton : plus jamais rogné, masqué ou décalé — et la photo de profil s’affiche désormais dans son en-tête' },
          { id: '0411c2', text: 'Avatar monogramme (SVG serveur) de nouveau visible partout : le filtre client n’acceptait que png/jpeg/webp — repli initiales si l’image échoue (topbar, sidebar, réglages)' },
        ],
      },
      {
        kind: 'fixes',
        items: [
          { id: '052c1', text: 'Enregistrement produit : PUT/POST blindés contre les schémas D1 incomplets (garde PRAGMA sur chaque colonne) — plus de 500 « Erreur interne » en production' },
          { id: '052c2', text: 'Photo de profil chargée via le proxy worker same-origin (/api/me/avatar) : le CORS de cdn1.afmarbre.com ne bloque plus l’avatar' },
          { id: '052c3', text: 'Boutons ✎ / ✕ des pièces jointes de l’agent toujours visibles, thèmes clair et sombre' },
        ],
      },
    ],
  },
  {
    version: '0.5.0-beta',
    date: '22 octobre 2026',
    sections: [
      {
        kind: 'fixes',
        items: [
          { id: '0410c1', text: '« Erreur interne — réessayez plus tard » sur l’enregistrement d’un produit : la migration optionnelle de la colonne des remises par quantité ne peut plus faire échouer la sauvegarde (PUT/POST produits blindés)' },
          { id: '0410c2', text: 'Les erreurs de sauvegarde s’affichent désormais dans la zone prévue de la fenêtre (bannière rouge au-dessus des boutons) — assistant Produits, ajustement de stock, règlements (Facturation + Vente rapide), réception des factures d’achat et approbations Actions ne passent plus par un toast masqué' },
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
    version: '0.4.4-beta',
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
    version: '0.4.3-beta',
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
    version: '0.4.2-beta',
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
    version: '0.4.1-beta',

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
    version: '0.4.0-beta',
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
    version: '0.3.4-beta',
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
    version: '0.3.3-beta',
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
    version: '0.3.2-beta',
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
    version: '0.3.1-beta',
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
    version: '0.3.0-beta',
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
    version: '0.2.0-beta',
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
    version: '0.1.8-beta',
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
    version: '0.1.7-beta',
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
    version: '0.1.6-beta',
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
    version: '0.1.5-beta',
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
    version: '0.1.4-beta',
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
    version: '0.1.3-beta',
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
    version: '0.1.2-beta',
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
    version: '0.1.1-beta',
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
    version: '0.1.0-beta',
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
    version: '0.0.4-beta',
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
    version: '0.0.3-beta',
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
    version: '0.0.2-beta',
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
    version: '0.0.1-beta',
    date: '27 juillet 2026',
    sections: [
      {
        kind: 'features',
        items: [
          { id: 'p1q2r3s', text: 'Première publication Atlas Commerce (stock, caisse, facturation)' },
          { id: '001a1', text: 'Première version interne (bêta) : stock, facturation et espace de travail Atlas Commerce' },
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
