import { expect, it } from 'vitest';
import { parseJournalDeviceContext } from '../lib/journalDeviceContext';

it('allows only bounded client-reported diagnostic fields', () => {
  expect(parseJournalDeviceContext(JSON.stringify({ language: 'fr-FR', timezone: 'Africa/Casablanca', orientation: 'portrait', theme: 'dark', touch: false, gpu: 'secret', ip: 'bad' }))).toEqual({ language: 'fr-FR', timezone: 'Africa/Casablanca', orientation: 'portrait', theme: 'dark', touch: false });
  expect(parseJournalDeviceContext('x'.repeat(513))).toBeUndefined();
  expect(parseJournalDeviceContext(JSON.stringify({ language: 'fr\nsecret', timezone: 'invalid time zone', theme: 'other', touch: 'yes' }))).toBeUndefined();
});
