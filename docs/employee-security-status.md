# Employee security — partial hardening, not a multi-tenant solution

The 12 routes in `worker/routes/employees.ts` revalidate the authenticated
identity against the current active account and use the existing finance
owner/admin gate. Employee form printing, attendance endpoints and employee
and combined-report preview use the same check. Finance routes use that check
as well, including `/api/me/payroll`; the latter and attendance self-check are
therefore no longer available to non-admin users. Existing `/api/reports/*`
uses its separate account-bound report authorization. The nav payroll badge is
masked for other roles, including on cache hits.

Legacy print tickets do not identify their issuer and cannot satisfy the new
check. Employee form/attendance print and employee/report previews now require
an authorized bearer session; existing ticket-only browser print flows may
stop working. This is intentional fail-closed behavior pending a compatible
identity-bound print capability. No deployment was made.

Resignation ignores former settlement inputs, changes employment status only,
and creates no payment or expense. Deletion is atomic with its inactive/no
payment check and refuses with `DELETE_BLOCKED` if a payment exists. This is a
conservative restriction, not a complete implementation of deletion with a
preserved payment history. A migrated historical schema might contain cascading
foreign keys. Check and migrate actual schemas and design safe retention before
allowing those deletions.

## Blocking isolation gap

The repository describes one company per D1. Its employee tables and session
have no trusted business/tenant identifier or membership mapping; the database
binding is global and `company_settings` is a singleton. Role checks do **not**
protect businesses that share a database, and guessing an existing ID in such a
shared database can expose or modify another business's data. Client-provided
business IDs cannot repair this. Do not deploy or treat this patch as meeting
multi-tenant isolation requirements. Separate database tests only check behavior
with distinct database bindings, not shared-database isolation.

A decision is required: either attest and enforce the existing one-company-per-
D1 architecture, with deployment/session/credential isolation independently
verified, or design a trusted session-to-business membership, migration of all
legacy rows and dependencies, scoped queries and storage keys, and fail-closed
handling for ambiguous historical data. Audit every indirect payroll/employee
surface and add shared-DB cross-business tests before declaring completion.
The new route tests cover the 12 direct endpoint gates, selected success and
not-found paths, resignation and conservative deletion; they do not yet cover
all owner/admin success cases, all print/attendance/finance routes or real D1,
R2, UI, and concurrent deletion/payment operations.
