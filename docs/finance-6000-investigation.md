# Investigation — unexplained 6,000 MAD on the admin finance screen (v258)

Status: **root cause identified in code, fixed, regression-tested.**
Scope of evidence: server calculation code + persisted-schema write paths in this
repo, plus the deployed worker contract. The production D1 database is **not
reachable from the development sandbox** (no Cloudflare/API egress), so the
final confirmation step is a one-command probe the owner can run (last section).
All evidence below is sanitized: no personal names, no account data, no secrets.

## 1. Where the 6,000 MAD appears in `GET /api/admin/finance/monthly`

Company scope: one company per deployment (`company-stock` worker + D1
`company-stock-db`); company isolation is structural (separate deployment,
separate database) — verified by test (`company isolation: two databases never
mix`). Selected period: the `period=YYYY-MM` query param (Android finance
screen passes the month shown). Timezone boundaries: all period math uses the
tenant timezone from `company_settings.finance_timezone` (production:
`Africa/Casablanca`); `as_of`/day boundaries via `localTodayYmd()`.

The same cash outflow of 6,000 MAD surfaces in **two response fields at once**:

- `payroll_paid` (or `supplier_paid`) — the legitimate payment total; and
- `expenses` — inflated by the same 6,000 (a phantom dépense), which also pulls
  `closing_balance` (and every later `opening_balance`) 6,000 below real cash.

So the screen shows a 6,000 amount with no matching invoice, expense receipt or
payroll decision behind it — because it is not a second movement of money, it
is the **same movement counted twice**.

## 2. Root cause — mirror ledger rows double-counted by the finance math

Write paths (persisted source records):

- Supplier payment (`POST` bill payment, worker/index.ts ≈ L11700): inserts
  `bill_payments` row **and** an `expenses` mirror row
  (`category='Règlement fournisseur'`, `entry_type='expense'`,
  `notes='bill_id:<id>|…'`) for the Solde cash journal UI.
- Payroll payment / advance (worker/routes/employees.ts ≈ L905 & L1220):
  inserts `employee_payments` row **and** an `expenses` mirror row
  (`category='Salaire'`, `entry_type='expense'`, `notes='employee_id:<id>|…'`).

Read path (v254 finance math, worker/lib/finance.ts):

- `SQL_EXPENSES` summed **all** `entry_type='expense'` rows — mirrors included;
- `SQL_BILLS_PAID` / `SQL_PAYROLL_PAID` summed the payment tables again;
- `closing_balance = sales − expenses − payroll_paid − supplier_paid` therefore
  subtracted every supplier and payroll payment **twice**.

Consequences matching the symptom: `expenses` shows a 6,000 "dépense" with no
purchase behind it; `closing_balance`/next `opening_balance` are 6,000 too low;
`payroll_paid`/`supplier_paid` look correct, which is why the pair reads as
"unexplained" on the tiles. Duplicates, voids and status were also inspected:
payments are append-only permanent rows (no status column, deletes not exposed),
negative amounts act as reversals and net out correctly (test), and exact
duplicate rows sum twice **and are now visible as two statement rows** instead
of being invisible inside an aggregate (test).

Second defect found while tracing (same family): credit notes (« Avoir … »)
insert an audit row into `invoice_payments` with a positive amount; the cash
effect is only the paired `Remboursement client` expense (cash slice). The old
`SQL_SALES` had no filter, so `sales_received` **and** `closing_balance` were
inflated by the credit-vs-debt slice of every credit note.

Third defect (boundary, not amount): invoice/bill payment routes defaulted
`paid_at` to the **UTC** date (`new Date().toISOString().slice(0,10)`) while all
finance period math reads tenant-local days — a payment made between local
midnight and 01:00 landed in the previous month (at month boundary: previous
period). Now defaults to the tenant day (`moroccoTodayStr()`), matching the
payroll routes which already used the local day.

## 3. API vs PDF vs statement — consistency

The PDF route and the new statement route derive from the **same**
`computeMonthlySummary` / canonical filtered SQL as the JSON endpoint
(`reconciliation.source='d1-live'`, no cached copy anywhere in the route —
stale caching excluded). Before the fix all three were *consistently wrong*
(same double subtraction), which is why comparing API and PDF showed no
difference while both disagreed with the bank/caisse. Rounding: every aggregate
passes `round2`; the statement additionally returns the invariant
`opening + credits − debits = closing` with a `balanced` flag.

## 4. Fix (v258)

- `SQL_SALES` excludes `note LIKE 'Avoir%'` audit trails.
- `SQL_EXPENSES` excludes mirror rows
  (`category='Règlement fournisseur' AND notes LIKE 'bill_id:%'`,
  `category='Salaire' AND notes LIKE 'employee_id:%'`).
  Retroactive for every period (math is live from rows; no data migration,
  nothing deleted — the Solde journal UI keeps displaying its mirror rows).
- `paid_at` defaults localized on both payment routes.
- New canonical ledger (`ledgerRows`, `computeStatement`) shared by summary,
  statement and PDF inputs.
- New endpoint `GET /api/admin/finance/statement?period=&page=&page_size=`
  (owner/admin gate, same 403 `FIN_FORBIDDEN` envelope) returning period,
  timezone, as_of, open/closed status, opening/closing balances, chronological
  rows (`type`, sanitized `label`/`ref` — employee rows use `emp_number`, never
  names or national ids — `debit`, `credit`, `ts`, `running_balance`), totals,
  pagination and the reconciliation block.
- Regression tests (worker/__tests__/finance.test.ts, v258 block): supplier
  6,000 counted once; payroll mirror excluded + advance label; avoir non-sales;
  running balance + pagination; open period stops at as_of; TZ boundary;
  duplicates visible; reversals net out; company isolation; summary ≡ statement
  ≡ PDF inputs.

## 5. Production confirmation probe (owner, sanitized output)

```bash
# which rows are mirrors vs real cash (amounts/dates only):
npx wrangler d1 execute company-stock-db --remote --command \
  "SELECT category, COUNT(*) n, SUM(amount) total FROM expenses WHERE notes LIKE 'bill_id:%' OR notes LIKE 'employee_id:%' GROUP BY category;"
# cross-check against the payment tables:
npx wrangler d1 execute company-stock-db --remote --command \
  "SELECT 'bill_payments' src, COUNT(*) n, SUM(amount) total FROM bill_payments UNION ALL SELECT 'employee_payments', COUNT(*), SUM(amount) FROM employee_payments;"
# then in the app (owner/admin): GET /api/admin/finance/statement?period=<month>
# → the 6,000 appears exactly once, as a supplier (or payroll) row, and
#   reconciliation.balanced = true.
```

Expectation after deploy: the phantom dépense disappears from `expenses`,
`closing_balance` rises by exactly the mirrored amounts of the period, and the
statement lists one row per real cash movement.
