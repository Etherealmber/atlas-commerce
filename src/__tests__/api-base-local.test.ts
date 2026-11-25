// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { getApiBase } from '../config';

describe('getApiBase on local dev (v0.9.3)', () => {
  it('uses same-origin on http://localhost so `npm run dev` talks to the local worker (demo test/test works offline)', () => {
    // happy-dom defaults to http://localhost:3000
    expect(window.location.protocol).toBe('http:');
    expect(getApiBase()).toBe('');
  });
});
