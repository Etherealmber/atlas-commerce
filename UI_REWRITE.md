# Atlas Commerce — UI rewrite (frontend only)

**Keep:** `worker/`, API, `scripts/`, `src/api.ts`, `src/auth.ts`, page business logic.
**Rewrite:** visual shell + every page to Bionis/Capitalio (option B).

## Phases
| Phase | Scope | Status |
|-------|--------|--------|
| 1 | Tokens + shell (sidebar, topbar) — kill green | Done |
| 2 | Dashboard UI | Done (ac-dash metrics/panels) |
| 3 | Shared kit: PageHeader, DataTable, FormCard | |
| 4 | Lists: products, clients, employees, vendors | |
| 5 | Docs: invoices, quotes, bills, receipts, VR | |
| 6 | Attendance, balance, reports, actions | |
| 7 | Settings / about / whats-new | |
| 8 | Mailbox + Atlas Agent chrome | |
| 9 | Login / welcome / legal | |
| 10 | Phone `/m` token align | |

## Rules
- `data-theme` light/dark
- Primary black/white; blue only accents
- One responsive app
