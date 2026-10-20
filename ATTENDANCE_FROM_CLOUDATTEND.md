# Attendance: Atlas vs CloudAttend (repo fourni)

## Implémenté dans Atlas (commerce / employés)
- Pointage journalier Entrée / Sortie (heure Maroc)
- **Modification manuelle** des heures + statut (Présent / Retard / Demi / Excusé / Absent)
- **Taux de présence du mois** par employé (%)
- **Paie suggérée** = salaire de référence × taux (validation manuelle sur page Employés)
- Stats du jour (présents / retards / absents)
- Marquer absents en masse (sans entrée)
- Activation via Réglages → RH

## Inspiré de CloudAttend, utile ensuite
| Idée CloudAttend | Intérêt Atlas | Priorité |
|------------------|---------------|----------|
| Statuts P/A/L/E + bulk mark | Fait (variant employés) | ✅ |
| % présence par personne + filtre dates | Taux mois fait ; plage libre possible | Moyenne |
| Dashboard charts (semaine) | Graph Présence sur Dashboard | Moyenne |
| Rapports export PDF/CSV | Rapport RH exportable | Moyenne |
| Notes / motifs d’absence | Note sur correction (fait) | ✅ |
| Compte self-service « étudiant » | Portail employé mobile (pointage soi-même) | Plus tard |
| Départements / matières | Départements magasin / équipes | Optionnel |
| E-mail credentials à l’inscription | N/A commerce | Non |
| REST CRUD subjects | N/A | Non |

## Non repris (hors scope commerce)
- Portail étudiant, sujets, départements académiques
- Django/AWS stack (Atlas = Workers + D1 + R2)
