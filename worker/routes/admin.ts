import type { AtlasApp } from './types';

export type AdminRouteDeps = {
  requireOwner: (c: any) => { ok: true; username: string } | { ok: false; response: Response };
  getOwnerUsername: (env: any) => string;
  ensureSecurityTables: (db: D1Database) => Promise<void>;
};

/**
 * Core admin routes extracted from the monolith.
 * Password / user create still needs hash helpers in index until auth-gate expands.
 */
export function registerAdminReadRoutes(app: AtlasApp, deps: AdminRouteDeps): void {
  app.get('/api/admin/users', async (c) => {
    const gate = deps.requireOwner(c);
    if (!gate.ok) return gate.response;
    await deps.ensureSecurityTables(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT id, username, role, display_name, active, created_by, created_at, last_login FROM app_users ORDER BY username`,
    ).all();
    const ownerUser = deps.getOwnerUsername(c.env);
    return c.json({
      success: true,
      data: {
        owner: {
          username: ownerUser,
          role: 'owner',
          display_name: 'Administrateur principal',
          source: 'cloudflare_secret',
        },
        users: results || [],
      },
    });
  });
}
