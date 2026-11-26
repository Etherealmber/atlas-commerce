/** Visual viewport can shrink for pinch zoom as well as the virtual keyboard. */
export function keyboardInset(layoutHeight: number, visibleHeight: number, offsetTop: number, scale: number): number {
  if (scale > 1.01) return 0;
  return Math.max(0, Math.round(layoutHeight - visibleHeight - offsetTop));
}
