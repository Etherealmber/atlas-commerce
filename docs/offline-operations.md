# Contrat des opérations stock hors-ligne (`offline-operations`)

Ce document définit le protocole de synchronisation hors-ligne entre l'application Android et le Worker Atlas Commerce, garanti par idempotence serveur et révisions optimistes par emplacement.

## 1. Lecture des emplacements et révisions

```http
GET /api/inventory/locations?product_id=<id>
Authorization: Bearer <token>
```

Réponse (`200 OK`) :

```json
{
  "success": true,
  "data": [
    {
      "location_id": "1",
      "id": 1,
      "code": "MAG",
      "name": "Magasin principal",
      "is_default": 1,
      "quantity": 40,
      "revision": 3
    }
  ]
}
```

Android utilise `revision` comme `expected_revision` avant de mettre en file d'attente un comptage (`count`).

## 2. Envoi d'un lot hors-ligne

```http
POST /api/inventory/offline-operations
Authorization: Bearer <token>
Content-Type: application/json
```

Rôles autorisés : `owner`, `admin`, `secretaire`, `stock` (identique aux autres écritures stock).

### Corps de requête

```json
{
  "device_id": "android-pixel-01",
  "client_ts": "2026-11-24T10:00:00Z",
  "operations": [
    {
      "op": "receive",
      "product_id": "12",
      "location_id": "1",
      "quantity": 12,
      "idempotency_key": "550e8400-e29b-41d4-a716-446655440001",
      "client_ts": "2026-11-24T09:58:00Z"
    },
    {
      "op": "issue",
      "product_id": "12",
      "location_id": "1",
      "quantity": 3,
      "idempotency_key": "550e8400-e29b-41d4-a716-446655440002",
      "client_ts": "2026-11-24T09:59:00Z"
    },
    {
      "op": "count",
      "product_id": "12",
      "location_id": "1",
      "counted_on_hand": 40,
      "expected_revision": 7,
      "idempotency_key": "550e8400-e29b-41d4-a716-446655440003",
      "client_ts": "2026-11-24T10:00:00Z"
    }
  ]
}
```

### Réponse (`200 OK`, succès partiel normal)

Les résultats sont renvoyés **dans le même ordre** que `operations[]` :

```json
{
  "success": true,
  "device_id": "android-pixel-01",
  "data": [
    {
      "op": "receive",
      "idempotency_key": "550e8400-e29b-41d4-a716-446655440001",
      "status": "applied",
      "http": 200,
      "revision": 8,
      "quantity": 52,
      "message": "Opération appliquée."
    },
    {
      "op": "issue",
      "idempotency_key": "550e8400-e29b-41d4-a716-446655440002",
      "status": "replayed",
      "http": 200,
      "revision": 9,
      "quantity": 49,
      "message": "Opération appliquée."
    },
    {
      "op": "count",
      "idempotency_key": "550e8400-e29b-41d4-a716-446655440003",
      "status": "conflict",
      "http": 409,
      "revision": 9,
      "quantity": 49,
      "current_quantity": 49,
      "code": "REVISION_CONFLICT",
      "message": "Conflit de révision : attendu 7, révision actuelle 9 (quantité 49)."
    }
  ]
}
```

## 3. Règles d'idempotence et de réessai

- Chaque écriture inclut un `idempotency_key` (UUID généré à la mise en file sur l'appareil).
- Le serveur calcule le SHA-256 du JSON canonique (clés triées, nombres normalisés : `12.0` ≡ `12`).
- **Même clé + même empreinte** : statut `replayed` (`http: 200`), aucune mutation supplémentaire. Sur le wrapper HTTP `withIdempotency`, l'en-tête `Idempotent-Replay: true` est ajouté.
- **Même clé + empreinte différente** : statut `rejected` avec `http: 409` (`IDEMPOTENCY_MISMATCH`), aucune écriture appliquée.
- **Atomicité D1** : l'insertion dans `offline_idempotency`, la mise à jour de `stock_location_qty` / `products` / `stock_location_revisions` et la ligne `stock_movements` (`device_id`, `client_ts`, `location_id`) s'exécutent dans un unique `db.batch()`.
- **Rétention** : les clés de plus de 7 jours sont purgées en tâche de fond via `executionCtx.waitUntil`.

## 4. Gestion des conflits de comptage (`count`)

- `receive` et `issue` sont des deltas commutatifs qui incrémentent la révision de l'emplacement.
- `count` impose `expected_revision == revision` courante :
  - Si elles correspondent : la quantité est fixée à `counted_on_hand`, la révision est incrémentée (`applied`).
  - En cas d'écart : statut `conflict` (`http: 409`), **aucun écrasement silencieux**, la quantité et la révision actuelles du serveur sont renvoyées pour revue manuelle côté Android.
- `location_id` est obligatoire : tout emplacement manquant, inconnu ou inactif renvoie `rejected`.
