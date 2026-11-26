// Generate a strictly local, disposable Worker configuration for visual review.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('.arena', { recursive: true });
const classes = ['MobileHub', 'RestoreHub', 'NumberHub', 'AgentQuotaHub', 'DemoHub'];
const config = {
  name: 'atlas-visual-demo', main: resolve('worker/index.ts'),
  compatibility_date: '2026-11-19', compatibility_flags: ['nodejs_compat'],
  vars: { ENVIRONMENT: 'development', TURNSTILE_SITE_KEY: '' },
  d1_databases: [{ binding: 'DB', database_name: 'visual-demo-local', database_id: 'visual-demo-local', migrations_dir: resolve('migrations') }],
  kv_namespaces: [{ binding: 'CACHE', id: 'visual-demo-local' }],
  r2_buckets: [{ binding: 'IMAGES', bucket_name: 'visual-demo-local' }],
  durable_objects: { bindings: classes.map((class_name) => ({ name: ({ MobileHub: 'MOBILE_HUB', RestoreHub: 'RESTORE_HUB', NumberHub: 'NUMBER_HUB', AgentQuotaHub: 'AGENT_QUOTA_HUB', DemoHub: 'DEMO_HUB' })[class_name], class_name })) },
  migrations: classes.map((name, i) => ({ tag: `visual-v${i + 1}`, new_sqlite_classes: [name] })),
};
writeFileSync('.arena/visual-worker.json', JSON.stringify(config, null, 2));
