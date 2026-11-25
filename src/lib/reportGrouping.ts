/**
 * Groups look-alike user reports (same title / same symptom typed several
 * times) so the « Signalements utilisateurs » list stays short.
 *
 * Similarity = overlap coefficient (shared / smaller set) over the
 * meaningful words of the report title (or of
 * the message when there is no « Titre: »). Device names, versions, DIAG
 * references and numbers are ignored.
 */
export type ReportLike = { id: number | string; message?: string | null; kind?: string | null; channel?: string | null; [k: string]: unknown };
export type ReportCluster<T extends ReportLike> = { key: string; title: string; items: T[] };

const STOP = new Set(['the', 'a', 'an', 'it', 'is', 'at', 'all', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'not', 'still', 'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'pas', 'ne', 'est', 'sur', 'dans', 'type', 'bug', 'other', 'titre', 'description', 'appareil', 'app', 'écran', 'ecran', 'réseau', 'reseau', 'wifi', 'actif', 'référence', 'reference', 'locale', 'affichage', 'interface', 'autre', 'anomalie', 'doesnt', 'doest', 'does', 'work', 'only', 'android', 'sdk', 'http', 'status', 'automatic', 'available', 'stage', 'web', 'page', 'app', 'apk', 'mise', 'jour', 'cant', 'can', 'use', 'some', 'same', 'after', 'plus', 'once', 'again', 'let', 'ask', 'me', 'my', 'with', 'when', 'qui', 'que', 'avec']);

/** The part a human typed: « Titre: … » (+ description), else the message head. */
export function reportTitle(message: string): string {
  const m = String(message || '');
  const title = /Titre\s*:\s*(.+?)(?=\s+(?:Description|Appareil|App)\s*:|$)/i.exec(m)?.[1];
  const desc = /Description\s*:\s*(.+?)(?=\s+(?:Appareil|App)\s*:|$)/i.exec(m)?.[1];
  return (title ? `${title}${desc ? ` — ${desc}` : ''}` : m.split(/\s+(?:Appareil|App|Android SDK)\s*:/i)[0]).trim().slice(0, 200);
}

/** Fold common typos so « paskkey », « passkye », « paskskye » meet « passkey ». */
function fold(w: string): string {
  if (/^pa[s]{1,2}k[s]?[ye]{1,2}y?e?$/.test(w) || /^pa[s]+k[a-z]{1,4}$/.test(w)) return 'passkey';
  if (/^(log(in)?|connexion|connect)$/.test(w)) return 'login';
  const base = w.replace(/s$/, '');
  return SYN[base] || base;
}

/** French / English words for the same symptom meet on one token. */
const SYN: Record<string, string> = {
  stuck: 'bloque', blocked: 'bloque', bloquee: 'bloque', bloquer: 'bloque', freeze: 'bloque', fige: 'bloque', figee: 'bloque',
  creation: 'creer', create: 'creer', creating: 'creer', cree: 'creer', creee: 'creer',
  empty: 'vide', blank: 'vide', crash: 'plantage', crashe: 'plantage', plante: 'plantage', crashed: 'plantage',
  invoice: 'facture', print: 'impression', imprimer: 'impression', printing: 'impression',
  slow: 'lent', lenteur: 'lent', lente: 'lent', password: 'motdepasse', scanner: 'scan', barcode: 'scan',
};

export function reportTokens(message: string): Set<string> {
  const t = reportTitle(message)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/diag-[\w-]+|v?\d+(?:\.\d+)+|\(\d+\)|\b\d+\b/g, ' ')
    .split(/[^a-z\u0600-\u06ff]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(fold);
  return new Set(t);
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const small = Math.min(a.size, b.size);
  // One shared word is only enough when one side IS that word (« passkye »);
  // otherwise « Impression ticket » would join « PDF facture vide à l’impression ».
  if (small > 1 && inter < 2) return 0;
  // Overlap coefficient: short titles (« passkey stuck ») still match the
  // long automatic ones (« Android passkey failure… »).
  return inter / small;
}

/**
 * Returns clusters of ≥ 2 similar reports and the remaining singles, both in
 * the original (newest-first) order.
 */
export function groupSimilarReports<T extends ReportLike>(reports: T[], threshold = 0.5): { clusters: ReportCluster<T>[]; singles: T[] } {
  const toks = reports.map((r) => reportTokens(String(r.message || '')));
  const clusterOf: number[] = Array.from({ length: reports.length }, () => -1);
  const clusters: { members: number[] }[] = [];
  for (let i = 0; i < reports.length; i++) {
    if (clusterOf[i] >= 0) continue;
    for (let j = 0; j < i; j++) {
      const cj = clusterOf[j];
      if (cj < 0) continue;
      if (clusters[cj].members.some((m) => similarity(toks[m], toks[i]) >= threshold)) {
        clusterOf[i] = cj;
        clusters[cj].members.push(i);
        break;
      }
    }
    if (clusterOf[i] >= 0) continue;
    // Start a new cluster if some later report matches this one.
    const mates: number[] = [];
    for (let j = i + 1; j < reports.length; j++) if (clusterOf[j] < 0 && similarity(toks[i], toks[j]) >= threshold) mates.push(j);
    if (mates.length) {
      const id = clusters.push({ members: [i] }) - 1;
      clusterOf[i] = id;
      for (const j of mates) { clusterOf[j] = id; clusters[id].members.push(j); }
    }
  }
  return {
    clusters: clusters.map((c) => {
      const items = c.members.sort((a, b) => a - b).map((m) => reports[m]);
      return { key: `c-${items[0].id}`, title: reportTitle(String(items[0].message || '')), items };
    }),
    singles: reports.filter((_, i) => clusterOf[i] < 0),
  };
}

export function pageOf<T>(list: T[], page: number, size: number): T[] {
  return list.slice(page * size, page * size + size);
}
