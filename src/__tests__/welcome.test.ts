import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WelcomePreview } from '../components/WelcomePreview';
import {
  WELCOME_PREVIEWS, WELCOME_PREVIEW_START, WELCOME_FEATURES_STEP,
  WELCOME_COMPARE_STEP, WELCOME_FINAL_STEP, WELCOME_STEP_COUNT,
  WELCOME_STEP_KEY, getWelcomeStep, setWelcomeStep, resetWelcome,
  markWelcomeCompleted, isWelcomeCompleted,
} from '../lib/welcome';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('welcome capture steps', () => {
  it('gives each of the seven captures its own screen before overview and comparison', () => {
    expect(WELCOME_PREVIEWS).toHaveLength(7);
    expect(new Set(WELCOME_PREVIEWS.map((p) => p.src)).size).toBe(7);
    expect(WELCOME_FEATURES_STEP).toBe(WELCOME_PREVIEW_START + WELCOME_PREVIEWS.length);
    expect(WELCOME_COMPARE_STEP).toBe(WELCOME_FEATURES_STEP + 1);
    expect(WELCOME_FINAL_STEP).toBe(WELCOME_COMPARE_STEP + 1);
    expect(WELCOME_STEP_COUNT).toBe(WELCOME_FINAL_STEP + 1);
  });

  it('renders only the current capture with a title, progress and previous/next controls', () => {
    for (let index = 0; index < WELCOME_PREVIEWS.length; index++) {
      const html = renderToStaticMarkup(createElement(WelcomePreview, { index, onPrevious() {}, onNext() {} }));
      expect((html.match(/<img /g) || []).length).toBe(1);
      expect(html).toContain(`src="${WELCOME_PREVIEWS[index].src}"`);
      expect(html).toContain(`Aperçu ${index + 1} sur 7`);
      expect(html).toContain('Précédent');
      expect(html).toContain('Suivant');
      expect(html).toContain('aria-labelledby="welcome-preview-title"');
      for (const other of WELCOME_PREVIEWS.filter((_, i) => i !== index)) {
        expect(html).not.toContain(`src="${other.src}"`);
      }
    }
  });

  it('has a still-image alternative for the demo when reduced motion is requested', () => {
    const html = renderToStaticMarkup(createElement(WelcomePreview, { index: 0, onPrevious() {}, onNext() {} }));
    expect(html).toContain('(prefers-reduced-motion: reduce)');
    expect(html).toContain('srcSet="/shots/devis-modal-dark.png"');
  });

  it('persists each new step including the inserted previews across refreshes', () => {
    for (let step = 0; step < WELCOME_STEP_COUNT; step++) {
      setWelcomeStep(step);
      expect(getWelcomeStep()).toBe(step);
    }
    setWelcomeStep(999);
    expect(getWelcomeStep()).toBe(WELCOME_FINAL_STEP);
    setWelcomeStep(-5);
    expect(getWelcomeStep()).toBe(0);
  });

  it('migrates old comparison and final indices without losing their place', () => {
    localStorage.setItem(WELCOME_STEP_KEY, '3');
    expect(getWelcomeStep()).toBe(WELCOME_COMPARE_STEP);
    localStorage.setItem(WELCOME_STEP_KEY, '4');
    expect(getWelcomeStep()).toBe(WELCOME_FINAL_STEP);
    localStorage.setItem(WELCOME_STEP_KEY, '2');
    expect(getWelcomeStep()).toBe(WELCOME_PREVIEW_START);
  });

  it('does not reopen completed installs and supports explicitly replaying the guide', () => {
    markWelcomeCompleted();
    expect(isWelcomeCompleted()).toBe(true);
    resetWelcome();
    expect(isWelcomeCompleted()).toBe(false);
    expect(getWelcomeStep()).toBe(0);
  });

  it('keeps previous and next callbacks separate', () => {
    const previous = vi.fn();
    const next = vi.fn();
    const view = WelcomePreview({ index: 0, onPrevious: previous, onNext: next });
    const nav = view.props.children[4];
    nav.props.children[0].props.onClick();
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    nav.props.children[1].props.onClick();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
