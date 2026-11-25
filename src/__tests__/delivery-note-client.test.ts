// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createDeliveryNote } = vi.hoisted(() => ({ createDeliveryNote: vi.fn() }));
vi.mock('../api', () => ({ api: { createDeliveryNote }, BASE: '' }));
vi.mock('../auth', () => ({ getToken: () => 'session' }));
import { openDeliveryNote } from '../lib/deliveryNote';

describe('delivery note window', () => {
  beforeEach(() => { vi.restoreAllMocks(); createDeliveryNote.mockReset(); });
  it('opens the created document in the reserved tab', async () => {
    createDeliveryNote.mockResolvedValue({ data: { id: 12, number: 'BL-2026-0001' } });
    const tab = { document: { title: '', body: { style: {}, textContent: '' } }, location: { href: '' }, closed: false, opener: window, close: vi.fn() };
    const result = await openDeliveryNote(4, tab as unknown as Window);
    expect(result.number).toBe('BL-2026-0001');
    expect(tab.location.href).toBe('/api/delivery-notes/12/print?token=session');
  });
  it('reports a blocked popup instead of claiming the print window opened', async () => {
    createDeliveryNote.mockResolvedValue({ data: { id: 12 } });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(openDeliveryNote(4, null)).rejects.toThrow('fenêtres contextuelles');
  });
  it('does not open an invalid print URL', async () => {
    createDeliveryNote.mockResolvedValue({ data: {} });
    await expect(openDeliveryNote(4, null)).rejects.toThrow('sans identifiant');
  });
});
