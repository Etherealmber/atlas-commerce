import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the experimental Actors adapter out of production entrypoints and bindings', () => {
  const entry = readFileSync('worker/index.ts', 'utf8');
  const config = readFileSync('wrangler.jsonc', 'utf8');
  expect(entry).not.toContain('actors-journal');
  expect(entry).not.toContain('@cloudflare/actors');
  expect(config).not.toContain('actors-journal');
  expect(config).toContain('"class_name": "JournalBuffer"');
  const experiment = readFileSync('experiments/actors-journal/JournalBufferActor.ts', 'utf8');
  expect(experiment).toContain('extends Actor<Env>');
  expect(experiment).toContain('this.legacy.alarm()');
});
