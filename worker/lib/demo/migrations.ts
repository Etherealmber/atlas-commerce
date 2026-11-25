/**
 * Bundled D1 migrations (0000 → latest), replayed into each demo sandbox.
 * Generated as plain strings (scripts/gen-demo-migrations.mjs) so it works with
 * Vite AND plain wrangler/esbuild — `import.meta.glob` is Vite-only.
 */
import { DEMO_MIGRATIONS_GENERATED } from './migrations.generated';

export const DEMO_MIGRATIONS: { name: string; sql: string }[] = DEMO_MIGRATIONS_GENERATED;
