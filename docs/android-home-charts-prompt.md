# Prompt: phone-friendly KPIs and charts on the Android home screen

Copy everything under "Prompt" into the Android agent. It mirrors what the web
phone shell (`src/mobile/PhoneHome.tsx`, `PhoneKpis.tsx`, `PhoneCharts.tsx`)
now shows, so both apps use the same data and look alike.

---

## Prompt

You are working on the Atlas Commerce Android app (Kotlin, Jetpack Compose,
Material 3). Rework the **Accueil** (home) screen so the KPIs and charts are
easy to read and touch on a phone. Use only the endpoints listed below. Do not
add any server endpoint. Keep the current colours, typography and dark mode,
and support French, Arabic (RTL) and English (see
`docs/android-demo-mode-and-reports-prompt.md` §9–§10).

### Data (already available, one request each, cache 60 s)

1. `GET /api/metrics/daily` → `{ days, dates[], series{key: (number|null)[]}, kinds{key:'flow'|'level'} }`
   - Flow keys (sum over the period): `sales`, `money_in`, `money_out`,
     `receipts`, `expenses`, `stock_moves`, `invoices_count`, `tickets_count`.
   - Level keys (use the latest non-null value): `products`, `in_stock`,
     `low_stock`, `out_of_stock`, `stock_value`, `receivables`, `payables`,
     `balance`, `pending_actions`.
   - Keys the role cannot read are **missing**. Hide that card or chart; never
     show 0 for a missing key.
   - The delta is the last `days` points compared with the `days` points
     before. If the previous value is 0, show « nouveau » instead of a percent.
     For `low_stock`, `out_of_stock`, `receivables` and `pending_actions`, a
     rise is bad (red).
2. `GET /api/dashboard` → `currentBalance`, `stockValue`, `unpaidSales{total,count,overdue}`,
   `monthlySeries[{key,label,sales}]`, `recentInvoices[]`.
3. `GET /api/admin/finance/monthly?period=YYYY-MM` (owner/admin) → `sales_received`,
   `expenses`, `payroll_paid`, `supplier_paid`, `opening_balance`, `closing_balance`,
   `receivables.total_outstanding`, `payables.total_outstanding`, `payroll.total_due`.

### Layout (top to bottom, 16 dp side padding, 12 dp gaps)

1. **Greeting** + refresh icon button (48 dp). Add pull-to-refresh on the
   whole screen.
2. **Hero card** (dark): treasury balance, with two pills for stock value and
   receivables. Non-admin roles see the number of active items and stock
   alerts instead.
3. **KPI carousel**: a `LazyRow` with snap, cards 160 dp wide and about
   112 dp high. Each card shows:
   - the label and « · 7 j »;
   - the value in one line, at 20 sp bold with tabular figures;
   - the delta chip with an arrow and a percent (or « nouveau »);
   - a 32 dp sparkline at the bottom.

   Show these KPIs: Ventes, Encaissements, Mouvements de stock, Stock bas,
   Demandes en attente. Values come from the metrics series above. Format
   money with a non-breaking space (`74 453 MAD`), never the narrow U+202F
   space (some fonts render it as nothing).
4. **Entrées & sorties** chart (money roles only), as a grouped bar chart over
   the last 14 days:
   - blue bars show `money_in`, amber bars show `money_out`;
   - the header has a net chip (green `+164 k MAD`, or red when negative);
   - the legend shows both totals in compact form (`185 k`, `1,2 M`);
   - show 5 date ticks, aligned to the last day.

   Tapping a day selects it, dims the others and shows « 25/11 · encaissé
   X MAD · décaissé Y MAD » below the chart. Hide the chart when both series
   sum to 0.
5. **Santé du stock** donut (every role). Its three segments are:
   - En stock (`in_stock`, or `products − low − out`), green #16A34A;
   - Stock bas (`low_stock`), amber #F59E0B;
   - Rupture (`out_of_stock`), red #DC2626.

   The centre shows « 83 % en stock ». Tapping a segment or its legend row
   (48 dp rows) shows that count in the centre. A « Voir » button opens the
   product list filtered on alerts.
6. Quick actions: Nouvelle vente / Scanner, Produits.
7. Info Box and Clients cards (unchanged).
8. **Tendance des ventes**: 6-month column chart from `monthlySeries`. Show a
   compact value above each column (`192 k`) and the full amount in the
   accessibility label. Never show an ellipsis.
9. **Solde & mouvements** (owner/admin): month picker (bottom sheet, not a
   spinner), then a **flow bar list**. It has one horizontal bar each for
   ventes encaissées (blue), dépenses (amber), salaires versés (violet) and
   fournisseurs réglés (sky), all scaled to the largest value. Below it, a
   « Résultat de trésorerie » row shows `sales_received − (expenses +
   payroll_paid + supplier_paid)` (green, or red when negative). Keep the
   existing detailed list and the PDF / report buttons below it.
10. Stock alert card, then recent documents.

### Rules

- **Charts**: draw them with Compose `Canvas` (no WebView) or Vico 2.x.
  Animate them in once over 250 ms, and respect « réduire les animations ».
- **Touch**: every touch target is at least 48 dp. There are no hover-only
  details; selection is by tap, and a second tap clears it.
- **Accessibility**: each chart has a `contentDescription` that summarises it
  (« Encaissé 185 000 MAD, décaissé 21 000 MAD sur 14 jours »). Values use
  tabular figures.
- **RTL (Arabic)**: mirror the layout and the bar order (time runs
  right-to-left), but keep digits Latin (`ar-MA` locale with Latin digits,
  the same as the web).
- **States**:
  - Loading shows skeletons with the same sizes, with no layout jump.
  - An error shows an inline message and a « Réessayer » button.
  - An empty series hides the chart rather than showing a flat zero chart.
- **Demo mode**: everything must work with the demo account (`test`/`test`);
  the data comes from the demo sandbox automatically.
- **Performance**: make at most these 3 requests on open, and none per card.
  Reuse the cached metrics response for every card and chart.

### Acceptance

- The screen fits on a 360 × 640 dp phone with no horizontal scroll except
  the KPI carousel.
- It works in light, dark, French, Arabic and English.
- Values match the web phone shell (`/m`) for the same account and day.
