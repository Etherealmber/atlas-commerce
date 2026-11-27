/** Final server replies replace their retry placeholder wherever it is in the thread. */
export function finishAgentReply<T extends { role: 'user' | 'assistant'; text: string; streaming?: boolean; variants?: string[]; variantIndex?: number }>(messages: T[], reply: T): T[] {
  let index = -1;
  messages.forEach((message, i) => { if (message.role === 'assistant' && message.streaming) index = i; });
  if (index < 0) return [...messages, reply];
  const next = [...messages];
  const variants = next[index].variants || [];
  next[index] = { ...reply, variants: [...variants, reply.text], variantIndex: variants.length };
  return next;
}
