/** Escape and bound all remote/configured values before embedding in a GitHub issue. */
export function safeReportText(value, limit = 800) {
  return String(value ?? '')
    .slice(0, limit)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/@/g, '[at]')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
}

/** Render findings as markdown, never as active markup supplied by a remote host. */
export function renderPatrolReport(doc) {
  const safe = safeReportText;
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const lines = [
    `## 🛡️ Security patrol — ${safe(doc.startedAt)}`,
    '',
    `Cible : **${safe(doc.base, 300)}** · ${safe(doc.passed, 12)}/${safe(doc.totalChecks, 12)} contrôles OK`,
    '',
  ];
  if (doc.coverage === 'incomplete') {
    lines.push('### ℹ️ Contrôles incomplets', '',
      'Le contrôle de santé a été bloqué par une protection en périphérie. La disponibilité de l’application et les autres contrôles ne sont pas vérifiés ; aucun résultat « tout va bien » ne peut être déduit.', '');
  }
  const waf = doc.waf;
  const blocked = Number(waf?.blocked);
  if (Number.isSafeInteger(blocked) && blocked > 0) {
    lines.push(
      '### 🚨 Intrusions réelles détectées et bloquées par le WAF', '',
      `**${blocked} requête(s) malveillante(s)** bloquée(s) depuis le dernier déploiement — dernière signature ${safe(waf.lastSig || '?', 200)} à ${safe(waf.lastAt || '?', 100)}.`,
      'Le pare-feu applicatif fonctionne : ces tentatives ont échoué (403 WAF_BLOCKED), rien à corriger de ce côté.', '',
    );
  } else if (waf && Number.isSafeInteger(blocked) && blocked === 0) {
    lines.push('### ✅ WAF', '', 'Aucune tentative d’intrusion bloquée depuis le dernier déploiement (compteur canary à 0).', '');
  } else {
    lines.push('### ℹ️ WAF', '', 'Compteur WAF indisponible ou invalide.', '');
  }
  if (findings.length) {
    lines.push(`### ⚠️ Points à corriger (${findings.length})`, '');
    for (const f of findings) {
      lines.push(`- **[${safe(String(f.severity).toUpperCase(), 30)}] ${safe(f.title, 200)}** — ${safe(f.detail)}`);
      lines.push(`  - 🔧 Fix possible : ${safe(f.fix, 1200)}`);
    }
    lines.push('');
  } else {
    lines.push('### ✅ Aucun point à corriger', '', 'Toutes les sondes d’intrusion sont bloquées, les en-têtes de sécurité sont présents et les endpoints sensibles refusent les accès non authentifiés.', '');
  }
  return lines.join('\n');
}

/** Do not let remote data inject the sentinel delimiters used by the workflow. */
export function encodePatrolJson(doc) {
  return JSON.stringify(doc).replace(/::/g, '\\u003a\\u003a');
}
