import { expect, it } from 'vitest';
import { qrToSvg } from '../qrSvg';
it('renders the light-theme Atlas mark on a white center plate with a four-module quiet zone', () => {
  const svg = qrToSvg('https://example.org/verify/abc', 100, 2);
  expect(svg).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="#ffffff"\/>/);
  expect(svg).not.toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="#0a0a0a"\/>/);
  expect(svg).toContain('data:image/png;base64,');
  expect(svg).toContain('M4 4h1v1h-1z');
});
