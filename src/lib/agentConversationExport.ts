/** A plain-text copy of one saved server snapshot, not an account archive or image export. */
export type ExportMessage = { role: 'user' | 'assistant'; text: string; streaming?: boolean };

export function formatAgentConversation(messages: ExportMessage[]): string {
  const visible = messages.filter(m => !m.streaming && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
  if (!visible.some(m => m.role === 'user')) throw new Error('Aucune conversation à télécharger.');
  return [
    'Atlas Agent — copie texte de la conversation enregistrée sur le serveur',
    'Les pièces jointes, images, contexte interne et autres données du compte ne sont pas inclus.',
    'Les modifications locales non synchronisées ne sont pas incluses.',
    '',
    ...visible.map(m => `${m.role === 'user' ? 'Utilisateur' : 'Atlas Agent'} :\n${m.text}`),
    '',
  ].join('\n\n');
}

export function downloadAgentConversation(messages: ExportMessage[]): void {
  const content = formatAgentConversation(messages);
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'atlas-agent-conversation.txt';
    anchor.style.display = 'none'; document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally {
    // Browsers may consume the object URL asynchronously after the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
