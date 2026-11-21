import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PhoneDock, { phoneDockItems, canOpenPhoneBalance, canOpenPhoneEmployees, phoneBackTarget, showPhoneDock } from '../mobile/PhoneDock';

describe('mobile dock', () => {
  it.each([
    ['owner', ['home', 'products', 'scan', 'balance', 'employees']],
    ['admin', ['home', 'products', 'scan', 'balance', 'employees']],
    ['secretaire', ['home', 'products', 'scan', 'balance']],
    ['stock', ['home', 'scan', 'products']],
    ['user', ['home', 'products', 'scan']],
    ['unknown', ['home', 'products', 'scan']],
  ])('shows only the permitted destinations for %s', (role, expected) => {
    expect(phoneDockItems(role).map((item) => item.id)).toEqual(expected);
  });

  it.each([
    ['owner', true, true], ['admin', true, true], ['secretaire', true, false],
    ['stock', false, false], ['user', false, false], ['unknown', false, false],
  ])('applies web page guards for %s', (role, balance, employees) => {
    expect(canOpenPhoneBalance(role)).toBe(balance);
    expect(canOpenPhoneEmployees(role)).toBe(employees);
  });

  it.each([
    ['/m', true], ['/m/scan', true], ['/m/products', true], ['/m/balance', true], ['/m/balance/classic', true], ['/m/employees', true],
    ['/m/settings', false], ['/m/agent', true], ['/m/more', false], ['/m/vente', true], ['/m/inbox', true], ['/m/device-scan', true], ['/m/warehouse', false],
  ])('uses the dock only on main routes: %s', (path, visible) => {
    expect(showPhoneDock(path)).toBe(visible);
  });

  it('returns subpages to their parent with a safe fallback for direct links', () => {
    expect(phoneBackTarget('/m/settings/whats-new')).toBe('/m/settings');
    expect(phoneBackTarget('/m/profile')).toBe('/m');
    expect(phoneBackTarget('/m/products/7/historique')).toBe('/m/products');
    expect(showPhoneDock('/m/products/7/historique')).toBe(false);
    expect(phoneBackTarget('/m/warehouse')).toBe('/m');
    expect(showPhoneDock('/m/settings/whats-new')).toBe(false);
  });

  it('marks the active page accessibly and keeps the scanner available', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/m/balance'] }, createElement(PhoneDock, { role: 'owner' })));
    expect(html).toContain('aria-label="Navigation principale"');
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/m\/balance"/);
    expect(html).toContain('href="/m/scan"');
    expect(html).not.toContain('href="/m/vente"');
  });
});
