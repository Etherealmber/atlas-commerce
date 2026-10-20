# Atlas Commerce — revue état & pistes (2026-09)

## UI fix (cette livraison)
- À propos → **Cookies** et **Revoir le guide** : mêmes liens texte que Privacy / Conditions (plus de pastilles vertes).

## Déjà en place (code + docs)
| Domaine | État |
|--------|------|
| Auth (login, OTP, WebAuthn, fingerprint) | OK |
| FA / VR / devis / ACH / clients / vendors | OK |
| Stock multi-entrepôt, mouvements, alertes | OK |
| Solde, dépenses, salaires employés | OK |
| NumberHub (séries), badges nav | OK |
| Mailbox admin (R2 corps chiffrés) | OK |
| Rapports HTML + ticket `rt` (refresh) | OK |
| Backup R2 chiffré, restore owner | OK |
| Atlas Agent (chat, outils métier) | OK |
| Mobile API / PhoneApp | OK (ne pas casser) |
| UBL local (préparation M1) | Partiel — pas de clearance DGI live |
| Employés (fiche Maroc, paie, pièce ID R2) | OK |
| Guide welcome + About | OK |

## Faiblesses connues
- Worker `index.ts` encore très monolithique (risque de régressions).
- Peu de tests automatisés (smoke POST facture / numérotation recommandés).
- UBL / e-invoicing DGI : format local seulement ; **clearance temps réel DGI pas branchée** (mandat progressif 2026–2028).
- Pointage présence : flag settings, module UI non livré.
- Agent history : miroir session + R2 ; pas d’UI « sync cloud » explicite.

## Pistes prioritaires (marché Maroc / SME)
1. **Préparation DGI e-facture** : UBL 2.1 stable, mentions légales ICE/IF/ICE, archivage 10 ans, pipeline clearance quand l’API officielle est publiée.
2. **Paie légère** : bulletin indicatif (CNSS / AMO mentions), export CSV paie.
3. **Relances clients** : rappels impayés (e-mail / WhatsApp lien).
4. **Lots / traçabilité** (option) pour négoce sensible.
5. **Liasse / exports comptable** (FEC-like ou export expert-comptable).
6. **Tests smoke** CI : login → FA → stock movement → report `rt`.
7. **Découpage worker** : `routes/invoices`, `stock`, `reports` déjà partiel — poursuivre.

## Non objectifs immédiats
- Compact mode (retiré volontairement).
- Token JWT dans les URL de rapports (remplacé par ticket `rt` court).
