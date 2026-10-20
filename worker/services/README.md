# Services layer

Business rules live here. Controllers call services; services call repositories (or `env.DB` via repos).

- **No HTTP / Hono Context** in services — pure inputs/outputs + `Env`.
- Throw `AppError` for domain failures (never raw D1 messages).
- Validate critical invariants before any write.
