# Repositories layer

All SQL / D1 access should eventually live here.

- Accept typed params only (never raw client JSON).
- Catch driver errors and rethrow `AppError('INTERNAL')` — never bubble SQL text.
- Keep queries small and named (`listProducts`, `getInvoiceById`, …).
