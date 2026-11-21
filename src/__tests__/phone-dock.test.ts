import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PhoneDock, { phoneDockItems, canOpenPhoneBalance, canOpenPhoneEmployees } from '../mobile/PhoneDock';

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

  it('marks the active page accessibly and keeps the scanner available', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/m/balance'] }, createElement(PhoneDock, { role: 'owner' })));
    expect(html).toContain('aria-label="Navigation principale"');
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/m\/balance"/);
    expect(html).toContain('href="/m/scan"');
    expect(html).not.toContain('href="/m/vente"');
  });
});
