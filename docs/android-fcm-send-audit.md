# Audit ciblé — envoi FCM Android

## Périmètre et état des preuves

Audit du dispatcher FCM, de l’enregistrement du jeton et du contrat de réception Android uniquement. Aucun changement d’authentification, d’OTP, de rôles/autorisations, de secrets, de Durable Objects ou de passkeys. Pas de changement de version ni du journal Nouveautés.

Sources Android examinées sur `Etherealmber/atlas-commerce-android` (main : `daceed03a02500ab90640f8b3b353aa7eb23cc05`) :
- `push/PushTokenRegistrar.kt`, `push/DeviceTokenRequest.kt` ;
- `push/AtlasFirebaseMessagingService.kt` ;
- `AtlasApp.kt`, `AndroidManifest.xml` ;
- `docs/firebase-and-background-notifications.md`.

| Vérification | Résultat |
| --- | --- |
| Récupération du jeton SDK à l’activation de session | Vérifiée dans le code Android : `FirebaseMessaging.getInstance().token.await()` |
| Rotation du jeton | Vérifiée dans le code : `onNewToken` appelle le registrar ; sans session, la prochaine activation relit le jeton SDK |
| Jeton courant réellement enregistré sur le Worker sélectionné | **Non vérifié en production** : aucun accès au téléphone, au contenu D1 de production ou au build installé |
| Projet Firebase / application du build installé | **Non vérifié** : `google-services.json` est hors Git et le jeton est opaque ; la configuration réelle du Worker n’a pas été lue |
| Payload serveur et classification des réponses FCM | Vérifiés par tests HTTP v1 simulés, y compris signature OAuth locale avec clé éphémère de test |
| Acceptation réelle d’un push par FCM | **Non vérifiée en production** : aucun envoi réel depuis cet environnement |
| Permission notifications Android et canal activés sur le téléphone | **Non vérifiés sur appareil** ; déclaration et création du canal vérifiées dans le code |

Ne pas confondre ces niveaux : l’accusé d’enregistrement du Worker n’est pas un accusé d’envoi FCM, et l’acceptation FCM n’est pas une preuve d’affichage Android.

## Constats et corrections

1. **Suppression trop large des jetons.** Le dispatcher supprimait sur tout HTTP 404 ou `NOT_FOUND`, y compris une erreur de projet/ressource. Désormais, en HTTP v1, seule une réponse d’échec contenant un détail typé `type.googleapis.com/google.firebase.fcm.v1.FcmError` avec `errorCode: UNREGISTERED` autorise la suppression. Tous les détails sont examinés, pas seulement le premier.
2. **Succès non inspectés.** Chaque réponse HTTP v1 est maintenant lue. Un envoi n’est compté accepté que sur réponse 2xx avec un `name` de message valide dans le projet ciblé. L’identifiant du message et le code HTTP sont journalisés ; un 2xx malformé n’est pas annoncé accepté.
3. **Erreurs à conserver sans purger.** `SENDER_ID_MISMATCH`, `INVALID_ARGUMENT`, erreurs de credentials, quota, 404 générique, 410, 429, 5xx et erreurs réseau ne provoquent pas de suppression. Pas de rafraîchissement arbitraire du jeton par le serveur : le SDK Android en est responsable.
4. **Payload visible.** Titre et corps non vides obligatoires ; aucune notification vide n’est envoyée. HTTP v1 conserve `notification.title`, `notification.body`, `android.notification.channel_id: atlas_assist`, et le click action existant. `data.event` est conservé ou dérivé des anciens champs `type`/`kind`, avec les IDs existants pour le clic. Aucun secret nouveau n’est ajouté au payload.
5. **Priorité.** Le comportement HIGH des alertes utilisateur sensibles au délai est conservé. L’option `priority: NORMAL` permet les envois non urgents ; elle ne remplace pas les réglages du canal Android.
6. **Pas de repli trompeur.** Quand un projet HTTP v1 est configuré, un échec OAuth ne bascule plus silencieusement vers une clé legacy potentiellement différente. Aucun secret n’est créé ou modifié.
7. **Legacy explicite uniquement.** Les déploiements sans projet v1 mais avec clé legacy gardent la compatibilité. La réponse par destinataire est examinée (un HTTP 200 peut être un échec). Seul `NotRegistered` autorise une suppression, jamais le statut HTTP seul. L’identifiant de canal et les métadonnées de clic sont aussi transmis.
8. **Journaux sûrs.** Aucun corps brut FCM/OAuth, exception brute, jeton d’enregistrement, jeton OAuth, clé privée, clé legacy ou contenu utilisateur dans les nouveaux logs. Les codes sont sur liste blanche ; les succès journalisent l’ID de message, pas le payload. L’échec d’enregistrement D1 ne journalise plus l’exception brute qui pourrait contenir les paramètres liés.
9. **Enregistrement fidèle.** Les jetons dépassant la limite existante de 512 caractères sont refusés explicitement au lieu d’être tronqués et enregistrés sous une valeur différente du SDK. Les jetons valides sont conservés tels quels et leur horodatage est mis à jour. Aucun nettoyage fondé seulement sur l’âge. L’ordre des jetons récemment enregistrés est déterministe en cas d’horodatage identique.
10. **Plusieurs bases.** La préparation de table est mémorisée par binding D1 au lieu d’un indicateur partagé entre toutes les bases.

`sendFcmToUser` conserve son résultat `{sent, purged}` : **sent = accepté par FCM**, pas « affiché ». Un échec sur un destinataire n’empêche pas l’essai des autres appareils ; il ne supprime pas son jeton.

## Vérification d’exploitation : deux validations séparées

### A. Enregistrement / projet / acceptation FCM

À effectuer localement par le propriétaire de l’environnement, sans publier de jetons ou credentials :

1. Sur **l’APK installé**, vérifier que Firebase est configuré. Comparer localement les identifiants non secrets de `FirebaseApp.getInstance().options` (`projectId`, `applicationId`, `gcmSenderId`) et le package du build avec l’application Android enregistrée dans Firebase. Le package attendu par le dépôt est `ma.etherealmber.atlascommerce` ; tenir compte d’un éventuel suffixe de build. Ne pas afficher l’ensemble de la configuration ni les clés.
2. Vérifier que le projet ciblé par la configuration existante `FIREBASE_PROJECT_ID` est le projet attendu par cette application. Un compte de service peut être autorisé sur un autre projet : ne pas conclure uniquement à partir de son adresse e-mail. Ne modifier aucun secret dans le cadre de cet audit.
3. Activer une session sur le Worker sélectionné. Le registrar doit relire le jeton SDK et recevoir `success: true, data.registered: true`. Vérifier l’horodatage de mise à jour de l’enregistrement côté D1. Ne pas exporter la colonne `token`, ni recopier un ancien jeton depuis des logs. Ne pas supprimer les autres enregistrements pour « forcer » le test.
4. Déclencher un événement métier déjà autorisé qui envoie à ce compte. Dans les logs Worker, rechercher `[fcm-send]` : `transport: v1`, `http_status: 200`, `outcome: accepted`, `message_id` non vide. Conserver uniquement cet ID et les codes pour l’audit.
5. Si `SENDER_ID_MISMATCH` apparaît : conserver le jeton et examiner le couple projet/app SDK et projet ciblé. Une acceptation FCM prouve le routage accepté dans ce projet, **pas à elle seule le package exact de l’application** : plusieurs applications peuvent appartenir au même projet.
6. Si FCM renvoie explicitement `UNREGISTERED`, le seul jeton concerné est supprimé. Faire relire/recréer et réenregistrer le jeton par le SDK Android, selon son cycle normal. Ne jamais générer un « nouveau token » côté Worker.

### B. Permission et canal Android — indépendant du succès FCM

Sur le téléphone test, ouvrir **Paramètres Android → Applications → Atlas Commerce → Notifications** :

- autorisation des notifications de l’application activée ;
- sur Android 13+, permission `POST_NOTIFICATIONS` accordée (la déclaration manifest seule ne suffit pas) ;
- canal **Assistant & notifications serveur**, ID `atlas_assist`, présent et non bloqué ; importance différente de `IMPORTANCE_NONE` ;
- vérifier séparément les modes silencieux/Ne pas déranger et les restrictions constructeur.

Pour un écran de diagnostic Android existant, relever uniquement les booléens/valeurs de : `NotificationManagerCompat.areNotificationsEnabled()`, permission runtime sur API 33+, et `NotificationManager.getNotificationChannel("atlas_assist")?.importance` sur API 26+. Aucun jeton dans ces diagnostics.

Le dépôt Android crée `atlas_assist` avec importance HIGH. Cela ne réactive pas un canal que l’utilisateur a bloqué. Tester un push visible application ouverte puis en arrière-plan ; noter séparément : accepté par FCM / affiché sur le téléphone. Une application forcée à l’arrêt, Doze ou la politique batterie d’un constructeur peuvent empêcher ou retarder l’affichage malgré un envoi accepté.

## Limites laissées volontairement hors modification

- Aucun accès à l’APK installé ni à ses préférences système : les cases A et B restent à valider sur l’environnement réel, pas déclarées réussies par les tests simulés.
- La sélection des destinataires métier n’est pas modifiée. Le helper historique de diffusion de stock lit `push_tokens`, tandis que le registrar APK écrit `device_push_tokens`. Cet écart peut expliquer une absence d’appel d’envoi pour certains comptes ; fusionner les listes élargirait potentiellement les destinataires et nécessite un examen séparé des règles métier, exclu de cette demande.
- Certains appelants possèdent leurs propres statuts de file d’attente. Leur état ne remplace pas l’accusé `[fcm-send] accepted` ; les workflows métier ne sont pas remaniés ici.
- Aucun déploiement production, rotation de secret ou modification de l’application Android dans cette session.

## Validation locale de cette correction

- Suite complète : **332 tests passent**.
- Dispatcher : **25 tests** ciblés couvrent le payload visible, HIGH/NORMAL, les réponses HTTP v1, `UNREGISTERED` au-delà du premier détail, conservation sur erreurs génériques/projet/quota, logs sans jetons, réponse 2xx invalide, panne par appareil, OAuth sans repli legacy et réponses legacy par destinataire.
- Route d’enregistrement : rejet sans troncature, erreurs sûres ; tests de notifications stock ajustés pour distinguer un vrai `NotRegistered` d’un simple 404.
- Build Vite OK ; oxlint 0 erreur ; contrôle CSS OK.
- TypeScript : 71 erreurs Worker / 74 client, dans la baseline existante, aucune nouvelle erreur dans les fichiers modifiés.
- Ces tests utilisent uniquement des réponses réseau simulées et une clé de test éphémère. Ils ne constituent pas une confirmation d’acceptation FCM en production ni d’affichage sur Android.
