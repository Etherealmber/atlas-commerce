# Android ↔ Worker — contrat 0.8.0

Version publique : **0.8.0**, canal beta. Aucune version suivante sans ordre explicite.
Ce document décrit le Worker de ce dépôt ; il ne signifie pas que l’APK a été modifié, compilé ou livré. Déployer le Worker avant de vérifier le contrat dans l’APK.

## 1. Connexion : verrouiller l’APK sans contourner l’OTP

La correction Android du drapeau « session restore disabled » reste côté APK. Le Worker n’active aucune restauration automatique : une reprise par mot de passe vérifie toujours les identifiants.

Préparation existante : `POST /api/auth/logout`, authentifié, avec le fingerprint de cette installation dans `X-Device-Fingerprint`.

Réponse additive, compatible avec les clients existants :

```json
{"success":true,"resume_prepared":true}
```

- `resume_prepared: true` : le marqueur du compte/appareil authentifié a été écrit pour 30 jours. Ce n’est ni un jeton de connexion ni une dispense permanente d’OTP.
- `success: true, resume_prepared: false` : aucun marqueur écrit (par exemple header fingerprint absent). L’application peut terminer son nettoyage local, mais ne doit pas annoncer une reprise préparée.
- Échec d’écriture : HTTP 503, `success: false`, `resume_prepared: false`, code `RESUME_PREPARATION_FAILED`.
- Authentification absente, invalide ou appareil révoqué : refus par le middleware, aucune exemption.

À la prochaine connexion, **le Worker seul décide `needs_otp`**. Avec 2FA désactivée, le même compte et le même fingerprint peuvent consommer un marqueur non expiré après vérification du mot de passe. La consommation est atomique : deux connexions simultanées ne peuvent pas réutiliser le même marqueur. Autre compte, autre appareil, mot de passe incorrect, marqueur absent/expiré ou appareil révoqué : pas de raccourci. Avec 2FA activée : OTP conservé.

Après un échec réseau, ne jamais simuler une réussite ni ignorer `needs_otp`. Un timeout est un résultat indéterminé : la requête peut avoir été traitée côté serveur avant la perte de l’accusé de réception. Il ne prouve ni création ni absence du marqueur.

Préserver côté Android : état SignedOut au nouveau processus, mot de passe requis, jeton précédent utilisé uniquement pour la préparation isolée, origine serveur strictement vérifiée, aucun jeton réinstallé globalement, nettoyage même en cas d’échec. Ne pas convertir une révocation en déconnexion volontaire. Ne pas modifier les flux QR/biométriques existants.

## 2. Atlas Agent : passer au SSE sans perdre les outils métier

La note « le Worker streaming n’a pas les outils métier » est dépassée : cette parité existe depuis la PR #156. La version 0.8.0 ajoute les propositions au contrat final et partage explicitement la sélection/l’autorisation des outils entre les routes classique et SSE.

### Requête

`POST /api/assist/chat/stream`, avec la session et le fingerprint habituels, `Content-Type: application/json`, `Accept: text/event-stream`. Les headers de version Android restent inchangés. `X-Atlas-Client: android` ne dispense jamais de l’authentification.

Même corps que `/api/assist/chat` : `message`, éventuellement `user_message`, `response_language` (`fr`, `en`, `ar`), `thread_id`, `task`, `timezone`, `documents`, `images`. Ne pas ajouter un second endpoint ou un deuxième moteur de conversation.

### Événements

Chaque frame se termine par une ligne vide. `data` est un objet JSON **direct**, sans enveloppe `success/data` :

```text
event: token
data: {"t":"Bonjour "}

event: token
data: {"t":"à vous."}

event: done
data: {"reply":"Bonjour à vous.","model":"model-id","provider":"groq","usage":{"prompt":20,"completion":8},"documents":[],"thread_id":"android-thread","tool_trace":[],"proposals":[],"task":"general","history_turns":0}

```

- `token` : ajouter `t` au message provisoire immédiatement, sans attendre la fin du body HTTP.
- `tool` : progression d’une exécution serveur, avec `name`, `ok`, et selon le cas `data`, `error`, `proposal`. Ne pas exécuter cette proposition automatiquement.
- `done` : réponse finale de référence. **Remplacer** le texte provisoire par `reply` (ne pas le concaténer une seconde fois), conserver les métadonnées et traiter le message comme terminé.
- `error` : objet avec `code` et `error`. Terminer la génération en erreur ; ne pas présenter le texte partiel comme une réponse complète.
- Fin de connexion sans `done` ni `error` : réponse interrompue, pas une réussite.
- Ignorer proprement les noms d’événements/champs inconnus pour la compatibilité future. Le parseur doit supporter les frames et caractères UTF-8 répartis sur plusieurs lectures réseau.

Les outils autorisés par rôle et les outils mémoire/savoir sont partagés avec la route classique. Si le chargement des préférences échoue, les outils métier sont exclus (repli fermé). Un outil désactivé ou non autorisé ne peut pas être exécuté, même si le modèle invente son appel. Les propositions ne proviennent que des résultats réussis d’outils serveur ; elles ne sont jamais devinées depuis le texte du modèle.

### Propositions

Les routes classique (`data.proposals`) et SSE (`done.proposals`) retournent désormais les mêmes propositions produites par leurs outils. Exemple d’ajustement :

```json
{"type":"inventory_adjustment","product_id":1,"product_name":"Produit","sku":"P1","delta":2,"current_stock":20,"note":"Proposition assistant IA","requires_approval":true}
```

La génération de cette proposition ne modifie pas le stock. L’APK affiche une confirmation et utilise le parcours métier autorisé existant ; ne pas inventer d’identifiant de proposition ni appeler `/api/assist/apply` sans l’identifiant et le contrat réellement requis par cette route. Aucun auto-approve.

Pour `type: inventory_adjustment`, après confirmation explicite de l’utilisateur, le parcours disponible est `POST /api/stock-adjustment-requests` avec la session habituelle et ce corps :

```json
{"product_id":1,"direction":"in","quantity":2,"reason":"Proposition assistant IA confirmée","idempotency_key":"une-cle-unique-par-confirmation"}
```

Convertir le delta : positif → `direction: in`, négatif → `direction: out`, `quantity = abs(delta)` strictement positive. Réutiliser la même clé en cas de retry de la même confirmation. Cette route soumet une **demande** : elle ne modifie pas directement le stock. Réponse 201 à la création ou 200 au replay idempotent, avec `data.id`. La validation séparée reste réservée aux rôles autorisés via `POST /api/stock-adjustment-requests/:id/approve` (ou `/reject`, corps `{"note":"..."}`). Respecter les erreurs de validation et de rôle du serveur ; ne jamais appeler automatiquement la route d’approbation.

### Erreurs et limites

- Avant l’ouverture du flux : erreurs HTTP JSON habituelles (session, quota/suspension Agent, document refusé, configuration…). Vérifier le statut HTTP avant de lancer le parseur SSE.
- Après ouverture : événement `error`. Ne pas relancer automatiquement la même requête sur l’endpoint bufferisé : un outil peut déjà avoir eu un effet. Éviter les doublons de requêtes/actions.
- Les contrôles de session, suspension, quota et documents sont conservés. Le quota normal utilise la consommation réelle cumulée des tours outils.
- La vision conserve son chemin bufferisé : une image peut donc produire un seul événement `token`, suivi de `done`. Les raccourcis locaux peuvent aussi arriver en un seul token. Ce n’est pas un défaut du parseur Android.
- `done.reply` prévaut sur les fragments : il peut être normalisé, nettoyé ou venir d’un repli final. Ne pas exiger que tous les chemins spéciaux soient tokenisés mot à mot.

## 3. Validation d’intégration Android

- Mettre à jour la note obsolète sur les outils SSE et basculer le chat texte sur l’endpoint streaming existant.
- Vérifier affichage progressif, remplacement final sans doublon, progression outils et propositions confirmées explicitement.
- Vérifier utilisateur stock vs propriétaire, outil désactivé, interruption réseau et erreur serveur.
- Vérifier langue de réponse, identifiant de conversation et documents.
- Vérifier préparation de reprise, mot de passe, 2FA on/off, autre compte/appareil et révocation.
- Ne pas modifier la version de l’APK sans instruction ; le bump 0.8.0 de cette livraison concerne le produit Worker/web.

Aucun secret, jeton, mot de passe ou OTP ne doit être affiché dans les journaux d’intégration.
