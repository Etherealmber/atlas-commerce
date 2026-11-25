// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installI18n, setLang, t, translate } from '../i18n';
import { DateRangePicker } from '../components/DatePicker';
import { ListPager } from '../components/ui/ListPager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installI18n();
afterEach(() => { setLang('fr'); document.body.innerHTML = ''; });

describe('Arabic desktop polish', () => {
  it('covers screenshot labels and dynamic demo durations', () => {
    setLang('ar');
    expect(translate('Historique des mouvements')).toBe('سجل الحركات');
    expect(translate('Modifier le client')).toBe('تعديل العميل');
    expect(translate('Abandonner la saisie ?')).toContain('التخلي');
    expect(translate('1 heure')).toContain('ساعة');
    expect(t('{duration} pour tout essayer', { duration: translate('1 heure') })).toContain('لتجربة كل شيء');
    expect(translate('CNSS salarié (taux, ex: 0.0448 = 4,48 %)')).toContain('الموظف');
  });
  it('localizes dates while preserving ISO values and direction-aware keyboard paging', async () => {
    setLang('ar');
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host); const page = vi.fn(); const change = vi.fn();
    await act(async () => root.render(createElement('div', null,
      createElement(DateRangePicker, { from: '2026-06-01', to: '2026-11-26', onChange: change }),
      createElement(ListPager, { page: 1, totalPages: 4, onChange: page }))));
    const trigger = host.querySelector<HTMLButtonElement>('.ac-dp-trigger')!;
    expect(trigger.textContent).toMatch(/[\u0600-\u06ff]/);
    await act(async () => trigger.click());
    expect(document.querySelector('.ac-dp-weekdays')?.textContent).toMatch(/[\u0600-\u06ff]/);
    expect(change).not.toHaveBeenCalled();
    const nav = host.querySelector('nav.ac-pager')!;
    await act(async () => nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(page).toHaveBeenCalledWith(2);
    await act(async () => root.unmount());
  });
});
