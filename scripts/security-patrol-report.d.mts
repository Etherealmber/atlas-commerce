export function safeReportText(value: unknown, limit?: number): string;
export function renderPatrolReport(doc: {
  startedAt: unknown;
  base: unknown;
  passed: unknown;
  totalChecks: unknown;
  coverage?: string;
  waf?: { blocked?: unknown; lastSig?: unknown; lastAt?: unknown } | null;
  findings?: Array<{ severity: unknown; title: unknown; detail: unknown; fix: unknown }>;
}): string;
export function encodePatrolJson(doc: unknown): string;
