import { expect, it } from 'vitest';
import { keyboardInset } from '../mobile/keyboardViewport';
it('tracks keyboard resize and viewport panning without mistaking pinch zoom for a keyboard', () => {
  expect(keyboardInset(800, 500, 0, 1)).toBe(300);
  expect(keyboardInset(800, 500, 40, 1)).toBe(260);
  expect(keyboardInset(800, 500, 0, 2)).toBe(0);
  expect(keyboardInset(500, 500, 0, 1)).toBe(0);
});
