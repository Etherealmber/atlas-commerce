/**
 * v0.7.7 — Atlas Agent : MÉMOIRE, CONTEXTE, GARDE-FOUS, OUTILS et RAG persistants.
 * Tout est stocké en D1, éditable depuis les Paramètres (ancres agent-knowledge)
 * et injecté côté serveur dans chaque conversation de l'Agent.
 *
 *  - agent_memory     : souvenirs par utilisateur (ou partagés org) ;
 *  - agent_context    : bloc de contexte org (métier, préférences de ton…) ;
 *  - agent_guardrails : règles impératives imposées au modèle ;
 *  - agent_tool_prefs : activation/désactivation des outils métier ;
 *  - agent_docs       : base de connaissances RAG (extraits indexés).
 */

export type AgentMemoryRow = {
  id: number;
  username: string;
  scope: 'user' | 'org';
  content: string;
  created_at: string;
};
export type AgentGuardrailRow = { id: number; rule: string; active: number; created_at: string };
export type AgentDocRow = { id: number; name: string; content: string; chars: number; created_at: string };

export type AgentKnowledge = {
  memory: AgentMemoryRow[];
  context: string;
  guardrails: AgentGuardrailRow[];
  toolPrefs: Record<string, 0 | 1>;
  docs: AgentDocRow[];
};

const MEMORY_MAX = 120;
const DOC_MAX = 40;
const DOC_CHARS_MAX = 20000;
const GUARDRAIL_MAX = 40;
const CONTEXT_CHARS_MAX = 4000;

export async function ensureAgentKnowledgeTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_memory_user ON agent_memory (username, id)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agent_context (
        scope TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agent_guardrails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agent_tool_prefs (
        tool TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agent_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        chars INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ),
  ]);
}

export async function loadAgentKnowledge(db: D1Database, username: string): Promise<AgentKnowledge> {
  await ensureAgentKnowledgeTables(db);
  const [mem, ctx, gr, tp, docs] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM agent_memory WHERE scope = 'org' OR username = ? ORDER BY id DESC LIMIT ${MEMORY_MAX}`,
      )
      .bind(username)
      .all(),
    db.prepare(`SELECT text FROM agent_context WHERE scope = 'org'`).first(),
    db.prepare(`SELECT * FROM agent_guardrails ORDER BY id ASC LIMIT ${GUARDRAIL_MAX}`).all(),
    db.prepare(`SELECT tool, enabled FROM agent_tool_prefs`).all(),
    db.prepare(`SELECT id, name, content, chars, created_at FROM agent_docs ORDER BY id DESC LIMIT ${DOC_MAX}`).all(),
  ]);
  const toolPrefs: Record<string, 0 | 1> = {};
  for (const r of (tp.results || []) as any[]) toolPrefs[String(r.tool)] = Number(r.enabled) ? 1 : 0;
  return {
    memory: (mem.results || []) as unknown as AgentMemoryRow[],
    context: String((ctx as any)?.text || ''),
    guardrails: ((gr.results || []) as unknown as AgentGuardrailRow[]).filter((g) => Number(g.active) === 1),
    toolPrefs,
    docs: (docs.results || []) as unknown as AgentDocRow[],
  };
}

/* ── CRUD ─────────────────────────────────────────────────────────────── */

export async function addMemory(db: D1Database, username: string, content: string, scope: 'user' | 'org'): Promise<AgentMemoryRow> {
  await ensureAgentKnowledgeTables(db);
  const clean = String(content || '').trim().slice(0, 500);
  if (!clean) throw new Error('MEMORY_EMPTY');
  const r = await db
    .prepare(`INSERT INTO agent_memory (username, scope, content) VALUES (?, ?, ?) RETURNING *`)
    .bind(username, scope, clean)
    .first();
  return r as unknown as AgentMemoryRow;
}

export async function deleteMemory(db: D1Database, id: number, username: string, isAdmin: boolean): Promise<boolean> {
  const row = await db.prepare(`SELECT username, scope FROM agent_memory WHERE id = ?`).bind(id).first() as any;
  if (!row) return false;
  if (!isAdmin && !(row.scope === 'user' && row.username === username)) return false;
  await db.prepare(`DELETE FROM agent_memory WHERE id = ?`).bind(id).run();
  return true;
}

export async function setContext(db: D1Database, text: string): Promise<void> {
  await ensureAgentKnowledgeTables(db);
  const clean = String(text || '').slice(0, CONTEXT_CHARS_MAX);
  await db
    .prepare(
      `INSERT INTO agent_context (scope, text, updated_at) VALUES ('org', ?, datetime('now'))
       ON CONFLICT(scope) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`,
    )
    .bind(clean)
    .run();
}

export async function addGuardrail(db: D1Database, rule: string): Promise<AgentGuardrailRow> {
  await ensureAgentKnowledgeTables(db);
  const clean = String(rule || '').trim().slice(0, 300);
  if (!clean) throw new Error('GUARDRAIL_EMPTY');
  const r = await db.prepare(`INSERT INTO agent_guardrails (rule) VALUES (?) RETURNING *`).bind(clean).first();
  return r as unknown as AgentGuardrailRow;
}

export async function setGuardrailActive(db: D1Database, id: number, active: boolean): Promise<boolean> {
  const r = await db.prepare(`UPDATE agent_guardrails SET active = ? WHERE id = ?`).bind(active ? 1 : 0, id).run();
  return (r.meta?.changes || 0) > 0;
}

export async function deleteGuardrail(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare(`DELETE FROM agent_guardrails WHERE id = ?`).bind(id).run();
  return (r.meta?.changes || 0) > 0;
}

export async function setToolPref(db: D1Database, tool: string, enabled: boolean): Promise<void> {
  await ensureAgentKnowledgeTables(db);
  await db
    .prepare(
      `INSERT INTO agent_tool_prefs (tool, enabled, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(tool) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
    )
    .bind(tool, enabled ? 1 : 0)
    .run();
}

export async function addDoc(db: D1Database, name: string, content: string): Promise<AgentDocRow> {
  await ensureAgentKnowledgeTables(db);
  const cleanName = String(name || 'Document').trim().slice(0, 120);
  const clean = String(content || '').trim().slice(0, DOC_CHARS_MAX);
  if (!clean) throw new Error('DOC_EMPTY');
  const r = await db
    .prepare(`INSERT INTO agent_docs (name, content, chars) VALUES (?, ?, ?) RETURNING *`)
    .bind(cleanName, clean, clean.length)
    .first();
  return r as unknown as AgentDocRow;
}

export async function deleteDoc(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare(`DELETE FROM agent_docs WHERE id = ?`).bind(id).run();
  return (r.meta?.changes || 0) > 0;
}

/* ── RAG : score lexical simple, déterministe et sans dépendance ──────── */

const STOP = new Set(
  'le la les un une des du de d l et ou à au aux ce cet cette ces mon ma mes ton ta tes son sa ses en dans sur pour par avec sans que qui quoi dont je tu il elle nous vous ils elles est sont suis es sommes êtes ai as a ont avoir être était fur mais donc or ni car ne pas plus moins très bien merci hello bonjour bonsoir salut the and for with from this that these those'.split(
    /\s+/,
  ),
);

function tokens(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export type RagHit = { id: number; name: string; excerpt: string; score: number };

/** RAG : retrouve les 3 meilleurs extraits de la base de connaissances. */
export function retrieveKnowledge(docs: AgentDocRow[], query: string, top = 3): RagHit[] {
  const qt = tokens(query);
  if (!qt.length || !docs.length) return [];
  const qset = new Set(qt);
  const hits: RagHit[] = [];
  for (const d of docs) {
    const chunks = String(d.content)
      .split(/\n{2,}/)
      .filter((c) => c.trim().length > 20);
    let best = '';
    let bestScore = 0;
    for (const ch of chunks.slice(0, 60)) {
      const ct = tokens(ch);
      if (!ct.length) continue;
      const present = new Set(ct);
      let score = 0;
      for (const q of qset) if (present.has(q)) score += 1;
      // léger bonus de densité pour éviter les murs de texte
      score += (score / Math.max(12, ct.length)) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = ch.trim();
      }
    }
    if (bestScore >= 2) hits.push({ id: d.id, name: d.name, excerpt: best.slice(0, 1400), score: bestScore });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, top);
}

/* ── Sections de prompt injectées côté serveur ────────────────────────── */

export function knowledgePromptSections(k: AgentKnowledge, query: string): string {
  const parts: string[] = [];
  if (k.context.trim()) {
    parts.push(`CONTEXTE MÉTIER (fourni par l'organisation — à respecter):\n${k.context.trim()}`);
  }
  if (k.guardrails.length) {
    parts.push(
      `GARDE-FOUS IMPÉRATIFS (règles absolues, prioritaires sur tout le reste):\n${k.guardrails
        .map((g, i) => `${i + 1}. ${g.rule}`)
        .join('\n')}`,
    );
  }
  if (k.memory.length) {
    parts.push(
      `MÉMOIRE DE L'UTILISATEUR (souvenirs enregistrés — utilise-les quand c'est pertinent):\n${k.memory
        .slice(0, 25)
        .map((m) => `- ${m.content}`)
        .join('\n')}`,
    );
  }
  const hits = retrieveKnowledge(k.docs, query);
  if (hits.length) {
    parts.push(
      `BASE DE CONNAISSANCES (extraits retrouvés par recherche — cite la source si tu t'en sers):\n${hits
        .map((h) => `【${h.name}】 ${h.excerpt}`)
        .join('\n\n')}`,
    );
  }
  return parts.length ? `\n\n=== SAVOIR ATLAS (interne, ne pas recopier tel quel) ===\n${parts.join('\n\n')}\n` : '';
}

/** Définitions OpenAI-compatible des outils mémoire/RAG exposés au modèle. */
export const KNOWLEDGE_TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'save_memory',
      description:
        "Enregistre un souvenir durable sur l'utilisateur ou le commerce (préférence, habitude, fait important) pour les prochaines conversations.",
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Le souvenir, en une phrase claire (max 500 caractères).' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall_memory',
      description: "Recherche dans la mémoire enregistrée de l'utilisateur les souvenirs pertinents.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Mots-clés de recherche.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description: "Interroge la base de connaissances interne de l'organisation (documents indexés).",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Question ou mots-clés.' } },
        required: ['query'],
      },
    },
  },
];
