/** Bundled D1 migrations (0000 → latest), replayed into each demo sandbox. */
const files = import.meta.glob('../../../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const DEMO_MIGRATIONS: { name: string; sql: string }[] = Object.keys(files)
  .sort()
  .map((k) => ({ name: k.split('/').pop() || k, sql: String(files[k] || '') }));
