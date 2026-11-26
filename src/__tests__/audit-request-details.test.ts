import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AuditRequestDetails } from '../components/audit/AuditRequestDetails';

describe('audit request details', () => {
  it('shows only recorded data and does not invent device or privacy information', () => {
    const html = renderToStaticMarkup(createElement(AuditRequestDetails, { kind: 'api', row: { ip: '192.0.2.1', country: 'JP', city: 'Tokyo', as_org: 'Example ISP', ua: 'Example UA' } }));
    expect(html).toContain('Example ISP');
    expect(html).toContain('Example UA');
    expect(html).toContain('<bdi dir="ltr" translate="no">192.0.2.1</bdi>');
    expect(html).toContain('<details class="audit-missing-details">');
    expect(html).toContain('Informations non enregistrées');
    expect(html).toContain('Navigation privée');
    expect(html).toContain('Non disponible');
    expect(html).not.toContain('China Standard Time');
    expect(html).not.toContain('Intel(R)');
  });
  it('discloses that the audit IP location is from a later API lookup', () => {
    const html = renderToStaticMarkup(createElement(AuditRequestDetails, { kind: 'audit', row: { geo: { country: 'MA' } } }));
    expect(html).toContain('dernier appel API');
  });
});
