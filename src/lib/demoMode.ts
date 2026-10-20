/**
 * Demo mode removed — stubs kept so legacy imports compile.
 * All functions are no-ops; isDemoMode() is always false.
 */

export type DemoSandbox = Record<string, never>;

export function isDemoMode(): boolean {
  return false;
}

export function enterDemoMode(): void {
  /* removed */
}

export function exitDemoMode(): void {
  /* removed */
}

export function resetDemoData(): void {
  /* removed */
}

export function getSandbox(): DemoSandbox | null {
  return null;
}

export function openDemoReport(_path?: string): void {
  /* removed */
}

export function openDemoInvoicePrint(_id?: number): void {
  /* removed */
}

export async function demoApiIntercept(_input?: unknown, _init?: unknown): Promise<null> {
  return null;
}

export function demoCreateClient(_data?: unknown): never {
  throw new Error('Mode démo désactivé');
}

export function demoCreateProduct(_data?: unknown): never {
  throw new Error('Mode démo désactivé');
}
