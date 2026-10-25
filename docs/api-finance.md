# API Finance, Paie & Rappels (v254)

Role-safe, server-authoritative finance endpoints for the Atlas Commerce worker.
Everything is computed **server-side from persisted ledger rows** — client-sent
totals, roles, periods-as-identity or demo data are never trusted for reads or
writes. All routes are additive: no existing route, field or client behaviour
changed.

> Demo mode (Android) stays fully local and must never call these endpoints.

---

## Authorization model

Identity and role come **only** from the verified session (`Authorization: Bearer <token>`,
re-validated inside every handler with `authFailReason` — defense in depth on top of the
global `/api/*` auth middleware). Roles:

| Role | Finance dashboard | Payroll | Monthly PDF | Reminders |
|---|---|---|---|---|
| `owner` / `admin` | ✅ | ✅ | ✅ | report + finance + payroll |
| `secretaire` | ❌ 403 | ❌ 403 | ❌ 403 | invoices/bills reminders only (established finance access) |
| `stock` / `user` | ❌ 403 | ❌ 403 | ❌ 403 | never |

- `secretaire` keeps its **existing** invoice/client access on the pre-existing routes
  (`canMutateBusiness`); the finance/payroll/admin-report surface here is owner/admin only.
- Recipients of scheduled notifications are re-derived from `app_users` **at delivery
  time** (active + role re-checked): a demoted or deactivated user never receives a
  message enqueued while they still had access.
- Tenant scoping: this deployment is single-company (`tenant = 'main'`, identity from
  `company_settings`). No endpoint accepts a tenant/company parameter, so cross-company
  IDOR or enumeration is structurally impossible.

### Error envelope (stable)

```jsonc
// 401 — missing/invalid session
{ "success": false, "error": "Session invalide", "code": "UNAUTHORIZED", "reason": "bad_password" }

// 403 — valid session, role not allowed
{ "success": false, "error": "Réservé aux administrateurs (owner/admin).", "code": "FIN_FORBIDDEN" }

// 400 — bad period
{ "success": false, "error": "Période invalide — format attendu YYYY-MM.", "code": "BAD_PERIOD" }
```

---

## `GET /api/admin/finance/monthly?period=YYYY-MM`

Owner/admin only. `period` optional (defaults to the current month in the company
timezone). All amounts are numbers rounded half-up to 2 decimals, in
`currency` (default `MAD`, `company_settings.finance_currency`).

```jsonc
{
  "success": true,
  "data": {
    "period": "2026-09",
    "timezone": "Africa/Casablanca",
    "currency": "MAD",
    "opening_balance": 48210.5,
    "closing_balance": 51060.25,
    "sales_received": 18500.0,       // Σ invoice_payments.amount, paid_at in period
    "refunds": 650.0,                // Σ expenses(entry_type='expense', category='Remboursement client')
    "expenses": 9200.25,             // Σ expenses(entry_type='expense') — refunds included, shown separately
    "payroll_paid": 6000.0,          // Σ employee_payments.amount, paid_at in period (advances included)
    "supplier_paid": 2200.0,         // Σ bill_payments.amount, paid_at in period
    "receivables": {
      "total_outstanding": 12400.0,
      "total_overdue": 3100.0,
      "count": 8, "truncated": false, // documents capped at 200
      "documents": [
        { "id": 142, "number": "F-2026-0142", "party": "Client Alpha",
          "total": 5000.0, "paid": 2000.0, "remaining": 3000.0,
          "due_date": "2026-09-15", "state": "overdue" }
      ]
    },
    "payables": { /* same shape, from bills + bill_payments */ },
    "payroll": { "total_due": 9000.0, "employees": 3 },
    "reconciliation": {
      "source": "d1-live",
      "generated_at": "2026-10-01T07:35:12.480Z",  // ISO-8601 UTC
      "rules": "docs/api-finance.md#calculation-rules",
      "as_of_date": "2026-09-30"
    }
  }
}
```

`documents[].state` is exactly one of `unpaid | partial | overdue | paid` (paid docs are
omitted) — derived from `remaining = total − Σ persisted payments` and `due_date` vs the
company-local today. Excluded from receivables: quotes/devis, cancelled, `VR-`/`WR-`
documents and `doc_kind` in (`quick_sale`, `ticket`, `remboursement`) — the same filter
the in-app `/api/alerts` feed uses.

### Calculation rules (v258 canonical filters)

- `sales_received` excludes « Avoir … » audit rows in `invoice_payments`
  (credit-note cash effect = paired `Remboursement client` expense row).
- `expenses` excludes mirror ledger rows written by the bill-payment and
  payroll routes (`Règlement fournisseur`/`bill_id:…`, `Salaire`/`employee_id:…`)
  — those exist only for the Solde cash journal UI. Before v258 every supplier
  and payroll payment was subtracted twice from balances (see
  `docs/finance-6000-investigation.md`).

**v259 — `mirror_audit` (automatic double-count audit).** The monthly summary and the statement
both embed a `mirror_audit` block: counts/totals of the excluded mirror ledger rows (`bill_id:` /
`employee_id:` notes) vs the `bill_payments` / `employee_payments` source tables, plus a
`consistent: true|false` flag. It runs **in production automatically** on every request — no
wrangler CLI, no PC needed — so the 6,000 MAD double-count fix
(`docs/finance-6000-investigation.md`) is continuously verified from the app itself. If a future
feature re-introduces mirror double counting, `consistent` flips to `false` in the live response.

### Legacy calculation rules

- **sales_received** — `invoice_payments` rows with `paid_at` inside the period (partial
  payments count in the month they were recorded; late-recorded payments land in the
  month of their `paid_at`, never silently rewritten).
- **expenses** — `expenses` with `entry_type='expense'` by `expense_date`. The ledger's
  `entry_type='income'` rows (encaissements) mirror `invoice_payments` and are excluded
  to avoid double counting.
- **refunds** — subset of expenses with `category='Remboursement client'` (avoirs `WR-`
  refuse payments via the existing `WR_NO_PAYMENT` rule; a refund is cash-out, recorded
  as an expense, and shows here separately).
- **closing_balance** — cumulative over ALL history ≤ period end:
  `Σ sales − Σ expenses − Σ payroll_paid − Σ supplier_paid`.
- **opening_balance** — `closing_balance − (period sales − expenses − payroll_paid − supplier_paid)`.
- **payroll.total_due** — accrued obligations of active employees due by period end:
  anchor = `last_paid_at || joined_date`, cycle = 30 days for `monthly` (else
  `pay_cycle_days`), pro-rata `(elapsed/cycle) × pay_amount` capped at one cycle,
  advances (`Acompte` payments since the anchor) deducted. **Never inferred from sales
  or user balances.**
- Voided/cancelled invoices are excluded everywhere; paid-in-full documents drop out of
  outstanding lists the moment their payments cover the total.

### Timezone semantics

Business dates (`due_date`, `expense_date`, `paid_at`) are plain `YYYY-MM-DD` strings in
the company timezone (`company_settings.finance_timezone`, default `Africa/Casablanca`).
Period bounds are inclusive local date ranges — a payment recorded `2026-09-30` belongs
to September even if its UTC `created_at` is already October. Machine timestamps
(`generated_at`, `created_at`) are ISO-8601 UTC. Morocco has no DST; the `Intl`-based
local-date computation is DST- and month-length-safe for any configured zone.

---

## `GET /api/admin/employees/payroll?period=YYYY-MM&page=1&page_size=50&due_before=YYYY-MM-DD`

Owner/admin only. Deliberately minimal fields — no phone, national id, sales figures or
balances ever leave the server on this route.

- `period` sets the accrual cut-off (`as_of` = min(today, period end)).
- `due_before` keeps only rows with `due_date ≤ due_before`.
- `page_size` max 200; rows sorted by `due_date` then `employee_id`; stable paging.

```jsonc
{
  "success": true,
  "data": {
    "period": "2026-10", "as_of": "2026-10-25",
    "timezone": "Africa/Casablanca", "currency": "MAD",
    "totals": { "amount_due": 4500.0, "unpaid_count": 2, "count": 5 },
    "page": 1, "page_size": 50, "total": 5, "has_more": false,
    "rows": [
      {
        "employee_id": 12,
        "display_name": "Karim Ben",
        "amount_due": 1500.0,
        "pay_period": { "from": "2026-10-01", "to": "2026-10-31" },
        "due_date": "2026-10-31",
        "status": "unpaid",            // 'unpaid' = due by as_of and amount > 0; else 'paid'
        "last_payment": { "amount": 500.0, "paid_at": "2026-10-10", "period_label": "Acompte octobre" }
      }
    ]
  }
}
```

`amount_due` already deducts advances recorded since the pay-period anchor. Recording a
salary payment stays on the existing `POST /api/employees/:id/payments` workflow
(unchanged) — this route never mutates.

---

## `GET /api/admin/finance/monthly/report.pdf?period=YYYY-MM`

Owner/admin only. Returns the monthly treasury report as a **generated-on-demand,
streamed** PDF:

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="rapport-mensuel-2026-09.pdf"`
- `Cache-Control: no-store`

Nothing is ever written to R2/public storage and there is no enumerable URL: the period
alone yields nothing without a verified owner/admin session (query-param `?token=`
print links are intentionally NOT accepted here). Each download writes an audit row
(`action: finance_report_pdf`, actor, ip, period).

Contents: period, currency, generation timestamp, opening/closing balances, sales,
expenses (with refunds broken out), payroll paid, supplier paid, outstanding client
amounts (total + overdue + up to 14 document lines), outstanding supplier amounts
(same), payroll still due (total + headcount), confidentiality footer. No unrelated
personal data — client/employee names only where they identify an obligation.

---

## Scheduled reminders (non-spammy by construction)

Trigger: wrangler cron `35 7 * * *` UTC ≈ **08:35 Africa/Casablanca** daily →
`scheduled()` → `runFinanceReminders`. An external scheduler can instead call:

```
POST /api/cron/finance-reminders
Authorization: Bearer <CRON_SECRET>        (or X-Cron-Secret: <CRON_SECRET>)
```

(503 `CRON_SECRET_MISSING` when the secret is unset, 401 `CRON_UNAUTHORIZED` on a wrong
secret — same contract as `/api/cron/backup-execute`.)

### Events & recipients

| Event | When | Recipients |
|---|---|---|
| `report_reminder:1:<period>` | day 1 of month, for the previous month | owner/admin — "rapport prêt" (or why not) + headline numbers |
| `report_reminder:2/3:<period>` | days 2 and 3 | owner/admin — **only what changed** since day 1 (stored snapshot diff: newly overdue, receivables/payables/payroll deltas) + link to the authorized report; "Aucun changement" otherwise |
| `invoice_due:<id>:<date>` | client invoice due **today** | owner/admin/secretaire — client *needs to pay* X today |
| `invoice_overdue:<id>:<due-month>` | client invoice overdue | owner/admin/secretaire — client *hasn't paid* / *partially paid*, amount + since when (once per due-month) |
| `bill_due:<id>:<date>` / `bill_overdue:<id>:<due-month>` | supplier bill due/overdue | owner/admin/secretaire — what **we** still need to pay |
| `payroll_due:<emp>:<due-month>` | salary obligation due | **owner/admin only** — secretaire never receives payroll |
| `payment_recorded:<id>:<date>` | a client payment is recorded (hooked into the existing payment handler) | owner/admin/secretaire — client *has paid* X, invoice soldée/partielle + remaining |

Client states are always explicit: *needs to pay* (due/overdue + remaining), *has paid*
(payment_recorded, soldée), *partial* (remaining after the recorded amount). Supplier
bills and payroll obligations are stated separately from client receivables.

### Delivery guarantees

- **Durable outbox**: `finance_outbox` table with `UNIQUE idem_key` where
  `idem_key = tenant|event|period|recipient`. Enqueue is `INSERT OR IGNORE` — duplicate
  cron runs, worker restarts, retried invocations and multi-instance races can never
  double-notify (structurally, not best-effort).
- **Retries**: FCM failures keep the row `pending` with exponential backoff
  (1 h → 2 h → 4 h → 8 h, `next_attempt_at` stored in D1) and give up at 5 attempts
  (`failed` + `last_error`). Every row carries a delivery audit trail
  (`status pending|sent|skipped|failed`, `attempts`, `sent_at`, `last_error`).
- **Re-authorization at delivery**: recipient must still exist, be `active`, and still
  hold the minimum role for that event — otherwise the row is `skipped`.
- **Privacy**: amounts appear in push bodies only while
  `company_settings.finance_push_amounts = 1`; set it to `0` and every digit run is
  masked (`—`) for lock-screen safety. Document numbers/titles stay (identifiers, not
  amounts).
- Channel: existing FCM push (`worker/lib/fcm.ts`, Android tokens); the in-app feed
  (`/api/alerts`) remains computed live and unchanged.

---

## Storage & migration

Created lazily and idempotently on first use (`ensureFinanceSchema`):

```sql
CREATE TABLE IF NOT EXISTS finance_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant TEXT NOT NULL DEFAULT 'main',
  event TEXT NOT NULL, period TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'push',
  title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}',
  idem_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')), sent_at TEXT
);
ALTER TABLE company_settings ADD COLUMN finance_timezone TEXT DEFAULT 'Africa/Casablanca';
ALTER TABLE company_settings ADD COLUMN finance_currency TEXT DEFAULT 'MAD';
ALTER TABLE company_settings ADD COLUMN finance_push_amounts INTEGER DEFAULT 1;
```

No existing table is modified beyond the three additive `company_settings` columns.

**Rollback**: remove the `triggers.crons` block from `wrangler.jsonc` and redeploy the
previous worker — the routes and table simply go unused; `DROP TABLE finance_outbox` is
optional and safe (nothing else references it). No data written by this feature is
required by any pre-existing flow.

---

## Android — required API/DTO additions

```kotlin
// GET /api/admin/finance/monthly?period=2026-09
data class FinanceMonthlyDto(
  val period: String, val timezone: String, val currency: String,
  @SerialName("opening_balance") val openingBalance: Double,
  @SerialName("closing_balance") val closingBalance: Double,
  @SerialName("sales_received") val salesReceived: Double,
  val refunds: Double, val expenses: Double,
  @SerialName("payroll_paid") val payrollPaid: Double,
  @SerialName("supplier_paid") val supplierPaid: Double,
  val receivables: OutstandingBucketDto, val payables: OutstandingBucketDto,
  val payroll: PayrollBucketDto, val reconciliation: ReconciliationDto,
)
data class OutstandingBucketDto(
  @SerialName("total_outstanding") val totalOutstanding: Double,
  @SerialName("total_overdue") val totalOverdue: Double,
  val count: Int, val truncated: Boolean, val documents: List<OutstandingDocDto>,
)
data class OutstandingDocDto(
  val id: Long, val number: String, val party: String,
  val total: Double, val paid: Double, val remaining: Double,
  @SerialName("due_date") val dueDate: String?, val state: String, // unpaid|partial|overdue
)
data class PayrollBucketDto(@SerialName("total_due") val totalDue: Double, val employees: Int)
data class ReconciliationDto(
  val source: String, @SerialName("generated_at") val generatedAt: String,
  val rules: String, @SerialName("as_of_date") val asOfDate: String?,
)

// GET /api/admin/employees/payroll?period=2026-10&page=1
data class PayrollPageDto(
  val period: String, @SerialName("as_of") val asOf: String,
  val timezone: String, val currency: String, val totals: PayrollTotalsDto,
  val page: Int, @SerialName("page_size") val pageSize: Int,
  val total: Int, @SerialName("has_more") val hasMore: Boolean, val rows: List<PayrollRowDto>,
)
data class PayrollTotalsDto(
  @SerialName("amount_due") val amountDue: Double,
  @SerialName("unpaid_count") val unpaidCount: Int, val count: Int,
)
data class PayrollRowDto(
  @SerialName("employee_id") val employeeId: Long,
  @SerialName("display_name") val displayName: String,
  @SerialName("amount_due") val amountDue: Double,
  @SerialName("pay_period") val payPeriod: PayPeriodDto,
  @SerialName("due_date") val dueDate: String?,
  val status: String, // unpaid|paid
  @SerialName("last_payment") val lastPayment: LastPaymentDto?,
)
data class PayPeriodDto(val from: String, val to: String)
data class LastPaymentDto(
  val amount: Double, @SerialName("paid_at") val paidAt: String,
  @SerialName("period_label") val periodLabel: String,
)

// PDF: GET /api/admin/finance/monthly/report.pdf?period=2026-09
// → stream to file with the Authorization header (no ?token= support), then share/open.
```

Forbidden (403) and unauthorized (401) responses use the stable envelopes shown above —
map `code == "FIN_FORBIDDEN"` to "Réservé aux administrateurs" in French UI copy.
Push notifications arrive via the existing FCM channel with
`data = { href, kind, period }` where `kind` is the event name from the reminders table.

---

## `GET /api/admin/finance/statement?period=YYYY-MM&page=1&page_size=50` (v258)

Server-backed monthly statement, owner/admin gate (same `FIN_FORBIDDEN`
envelope). One canonical ledger over the five persisted cash sources — the
monthly summary, this statement and the PDF all derive from the same filtered
queries, so they cannot disagree:

- **credit** = `invoice_payments` excluding « Avoir … » audit trails (a credit
  note's cash effect lives in its paired `Remboursement client` expense row);
- **debit** = real `expenses` (mirror ledger rows excluded:
  `Règlement fournisseur`+`notes bill_id:…`, `Salaire`+`notes employee_id:…`),
  client refunds, `employee_payments`, `bill_payments`.

Response (additive, stable codes):

```json
{
  "success": true,
  "data": {
    "period": "2026-10",
    "timezone": "Africa/Casablanca",
    "currency": "MAD",
    "as_of": "2026-10-25",
    "status": "open",
    "opening_balance": 1234.56,
    "closing_balance": 2345.67,
    "totals": { "credits": 5000.0, "debits": 3888.89, "net": 1111.11 },
    "reconciliation": {
      "opening": 1234.56, "credits": 5000.0, "debits": 3888.89,
      "closing": 2345.67, "balanced": true,
      "rule": "opening + credits - debits = closing"
    },
    "page": 1, "page_size": 50, "total": 12, "has_more": false,
    "rows": [
      {
        "id": 41, "source": "bill_payments", "type": "supplier",
        "label": "Règlement achat ACH-500", "ref": "ACH-500",
        "debit": 6000.0, "credit": 0, "ts": "2026-10-05",
        "running_balance": -4765.44
      }
    ]
  }
}
```

Row `type` ∈ `sale | refund | expense | payroll | supplier`. Labels/refs are
sanitized: payroll rows expose `emp_number` (or `EMP-<id>`) and the payment
label — never names, national ids or balances. `status` is `open` for the
current tenant-timezone month (rows stop at `as_of`) and `closed` otherwise
(full period). Pagination is over rows only; totals and reconciliation always
cover the whole period. Errors: `400 BAD_PERIOD`, `401 UNAUTHORIZED`,
`403 FIN_FORBIDDEN`, `500 FINANCE_ERROR`.

Investigation of the duplicated 6,000 MAD symptom (mirror ledger rows counted
twice before v258) and the production confirmation probe:
`docs/finance-6000-investigation.md`.

---

## `GET /api/admin/finance/period?period=YYYY-MM` (v264)

Owner/admin gate (same `FIN_FORBIDDEN` envelope). Cash & bank breakdown of the
selected period — **same timezone and canonical ledger rules as the
statement**, computed only from persisted rows:

- identical filtered sources (`invoice_payments` excluding « Avoir » trails,
  `expenses` `entry_type='expense'` excluding mirror rows,
  `employee_payments`, `bill_payments`);
- an OPEN month stops at `as_of` = today in the company finance timezone,
  a CLOSED month is the full calendar month;
- the embedded `statement` block is `computeStatement()`'s own output and
  `consistent_with_breakdown` re-checks the invariant on every call — this
  endpoint cannot disagree with `GET /api/admin/finance/statement`.

Payment-method buckets (canonical app rule — `src/pages/Balance.tsx`
`isCash`): `cash` = persisted `'cash'`/`''`/NULL (the schema DEFAULT, a
recorded value — not a guess); `bank`/`card`/`check` = the recorded
vocabulary of the payment selector; `other` = a recorded method outside that
vocabulary (surfaced as-is, never merged away); `not_recorded` = sources with
NO `payment_method` column (`employee_payments` — payroll is never guessed
cash or bank). Headline split: `cash` vs `bank` where **bank =
bank+card+check+other** (the app's caisse/banque view). Invariant per source:
`total = cash + bank + not_recorded`.

Owner movements (`entry_type` `owner_contrib`/`owner_draw`) and recorded misc
income (`entry_type='income'`) are real `expenses` rows but are **excluded
from statement cash** — they live in separate blocks
(`owner.contributions`, `owner.withdrawals`, `inflows.by_source.recorded_income`)
and are never folded into statement credits/debits.

```json
{
  "success": true,
  "data": {
    "period": "2026-09", "timezone": "Africa/Casablanca", "currency": "MAD",
    "as_of": "2026-09-30", "status": "closed",
    "inflows": {
      "total": 2350.0, "count": 5, "cash": 1500.0, "bank": 850.0, "not_recorded": 0,
      "by_method": { "cash": 1500.0, "bank": 600.0, "card": 250.0, "check": 0, "other": 0, "not_recorded": 0 },
      "by_source": {
        "invoice_payments": { "total": 1750.0, "count": 3, "cash": 1000.0, "bank": 750.0, "…": "…" },
        "recorded_income":   { "total": 600.0,  "count": 2, "cash": 500.0,  "bank": 100.0, "…": "…" }
      }
    },
    "outflows": {
      "total": 6015.0, "count": 6, "cash": 1065.0, "bank": 950.0, "not_recorded": 4000.0,
      "refunds_total": 90.0,
      "by_source": {
        "expenses": { "total": 515.0,  "count": 4, "cash": 365.0, "bank": 150.0 },
        "payroll":  { "total": 4000.0, "count": 1, "cash": 0, "bank": 0, "not_recorded": 4000.0 },
        "supplier": { "total": 1500.0, "count": 2, "cash": 700.0, "bank": 800.0 }
      }
    },
    "owner": {
      "contributions": { "total": 2000.0, "count": 1, "cash": 0, "bank": 2000.0 },
      "withdrawals":   { "total": 300.0,  "count": 1, "cash": 300.0, "bank": 0 },
      "net": 1700.0
    },
    "expense_categories": [
      { "category": "Loyer", "total": 350.0, "count": 2 },
      { "category": "Remboursement client", "total": 90.0, "count": 1 },
      { "category": "Sans catégorie", "total": 75.0, "count": 1 }
    ],
    "categories_truncated": false,
    "statement": {
      "opening_balance": 0, "credits": 1750.0, "debits": 6015.0,
      "closing_balance": -4265.0, "net": -4265.0, "balanced": true,
      "consistent_with_breakdown": true,
      "rule": "opening + credits - debits = closing — identical rows to GET /api/admin/finance/statement"
    },
    "mirror_audit": { "…": "same block as monthly/statement" }
  }
}
```

`expense_categories` covers the statement's expense slice (refunds included,
sorted by total desc, capped at 100 rows with `categories_truncated`).
Errors: `400 BAD_PERIOD`, `401 UNAUTHORIZED`, `403 FIN_FORBIDDEN`,
`500 FINANCE_ERROR`. Tests: `worker/__tests__/finance.test.ts` (v264 blocks).

---

## Ledger write authorization (v264 audit fix)

`POST /api/expenses` and `POST /api/expenses/import` are **owner/admin only**
(`403 OWNER_ONLY`). Before v264 they sat behind the generic `/api/*`
authentication middleware only — any authenticated role (`stock`, `user`,
`secretaire`…) could insert ledger rows, including owner movements
(`entry_type` `owner_contrib`/`owner_draw`). The routes now live in
`worker/routes/expenses.ts` with defense-in-depth session re-validation
(`authFailReason`) exactly like every finance surface, plus an audit trail
(`expense.create` / `expense.import`). Validation contract unchanged:
`422 VALIDATION` (amount bounds), `400` (missing description), entry_type
whitelist coerces unknown values to `expense`. `DELETE /api/expenses/:id`
keeps its existing gate (secretaire+ with password confirm). Tests:
`worker/__tests__/expenses-auth.test.ts`.

---

## `GET /api/me/payroll` — employee-SELF pay date (v256)

Role-safe by construction: **any** authenticated session (`user`, `stock`,
`secretaire`, `admin`, `owner`) may call it, but it only ever returns the
payroll obligation of the ONE employee file linked to the caller's own login —
the username is taken exclusively from the verified session (no query params,
no body, no way to ask for someone else).

Linking: `employees.user_username` (new column, migration-safe) is set by an
owner/admin in the employee form ("Compte lié (identifiant de connexion)") or
via `POST/PUT /api/employees`. Matching is `LOWER(TRIM(user_username))`.

```http
GET /api/me/payroll
Authorization: Bearer <session>
```

Responses:

- `200` linked + payroll configured:

```json
{
  "success": true,
  "data": {
    "linked": true,
    "payroll_configured": true,
    "employee_id": 12,
    "display_name": "Yasmine B.",
    "amount_due": 1450.00,
    "pay_period": { "from": "2026-09-26", "to": "2026-10-26" },
    "due_date": "2026-10-26",
    "daily_rate": 48.33,
    "status": "unpaid",
    "last_payment": { "amount": 2900.00, "paid_at": "2026-09-26", "period_label": "Salaire septembre" },
    "as_of": "2026-10-25",
    "timezone": "Africa/Casablanca",
    "currency": "MAD"
  }
}
```

- `200` linked but payroll not configured (`pay_amount` 0 or no anchor date):
  `{ linked: true, payroll_configured: false, employee_id, last_payment, ... }` —
  show "Date de paie non configurée" in the app.
- `404` `PAYROLL_NOT_LINKED` — no employee file linked to this login. French UI
  copy: "Aucune fiche employé liée à votre compte."
- `409` `PAYROLL_AMBIGUOUS` — two employee files share the same login (admin
  must fix the link).
- `401` `UNAUTHORIZED` — invalid/expired session (with `reason`).

Math is identical to the admin payroll route (pro-rata accrual, advances
deducted, capped at one cycle) — same `payrollObligation()` function, computed
as of today in the tenant timezone. The employee sees their own amounts; that
is their data, never another row's.

Android usage: call it on the Profil/Accueil screen for non-admin roles and
render `due_date` ("Prochaine paie : 26/10/2026") plus `status`; no admin
finance surface is exposed to employees.

---

## Tests

`worker/__tests__/finance.test.ts` (25 tests, vitest): period/leap/TZ-boundary math,
doc classification, gates for all five roles + anonymous, payroll accrual/cap/advances,
PDF byte structure, and real-SQLite integration for outbox dedupe, monthly summary math,
receivable/payable filters, reminder recipients per event, cross-month anti-spam,
delivery-time re-authorization (demoted/deactivated skipped), day 1/2/4 report sequence,
payment-recorded dedupe, retry/backoff/attempt-cap, and lock-screen amount masking.
