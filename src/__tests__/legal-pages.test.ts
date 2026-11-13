/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Licenses from '../pages/Licenses';
import Privacy from '../pages/Privacy';
import Terms from '../pages/Terms';
import { titleForPath } from '../lib/pageTitle';

vi.mock('../auth', () => ({ isLoggedIn: () => false, isStockRole: () => false }));

function render(page: typeof Licenses) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(page)));
}

describe('legal pages', () => {
  it('summarizes the license choice and links to both full texts in the repository', () => {
    const html = render(Licenses);
    expect(html).toContain('MIT OR Apache-2.0');
    expect(html).toContain('https://github.com/Etherealmber/atlas-commerce/blob/main/LICENSE"');
    expect(html).toContain('https://github.com/Etherealmber/atlas-commerce/blob/main/LICENSE-APACHE"');
    expect(html).not.toContain('END OF TERMS AND CONDITIONS');
    expect(readFileSync('LICENSE', 'utf8')).toContain('MIT License');
    expect(readFileSync('LICENSE-APACHE', 'utf8')).toContain('Apache License');
  });

  it('links the updated terms and privacy pages to the license page', () => {
    for (const page of [Terms, Privacy]) {
      const html = render(page);
      expect(html).toContain('href="/licenses"');
      expect(html).toContain('20 octobre 2026');
    }
    expect(render(Privacy)).toContain('auto-hébergé');
  });

  it('registers the license route in desktop, phone and public routers', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source.match(/<Route path="\/licenses" element=\{<Licenses \/>\} \/>/g)).toHaveLength(3);
    expect(titleForPath('/licenses')).toContain('Licences');
  });
});
