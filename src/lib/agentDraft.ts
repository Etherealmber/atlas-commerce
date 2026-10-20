/** Session bridge: Atlas Agent → open create/edit modals on target pages. */

export type AgentDraft = {
  open?: string | boolean;
  entity?: 'product' | 'client' | 'invoice' | 'quote' | 'receipt' | 'employee' | 'vendor' | 'expense' | 'bill';
  mode?: 'create' | 'edit';
  prefill?: Record<string, unknown>;
  source_file?: string;
  note?: string;
};

const KEY = 'atlas-agent-draft';
export const AGENT_DRAFT_EVENT = 'atlas-agent-draft';

export function setAgentDraft(draft: AgentDraft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* */
  }
  try {
    window.dispatchEvent(new CustomEvent(AGENT_DRAFT_EVENT, { detail: draft }));
  } catch {
    /* */
  }
}

export function consumeAgentDraft(): AgentDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as AgentDraft;
  } catch {
    return null;
  }
}

/** Subscribe to draft opens (mount + live event). Returns unsubscribe. */
export function onAgentDraft(handler: (d: AgentDraft) => void): () => void {
  const runStored = () => {
    const d = consumeAgentDraft();
    if (d) handler(d);
  };
  const onEvt = (e: Event) => {
    const d = (e as CustomEvent).detail as AgentDraft | undefined;
    if (d) {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* */
      }
      handler(d);
    }
  };
  // next tick so page state is ready
  setTimeout(runStored, 0);
  window.addEventListener(AGENT_DRAFT_EVENT, onEvt as EventListener);
  return () => window.removeEventListener(AGENT_DRAFT_EVENT, onEvt as EventListener);
}
