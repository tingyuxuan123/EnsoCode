import { expect, it } from 'vitest';
import { extractTriggerQuery, normalizeCandidates, normalizePick } from './triggers';

it('recognizes only word-initial # triggers', () => {
  expect(extractTriggerQuery('look #demo')).toBe('demo');
  expect(extractTriggerQuery('#')).toBe('');
  expect(extractTriggerQuery('a#b')).toBeNull();
  expect(extractTriggerQuery('#a b')).toBeNull();
});
it('caps and deduplicates untrusted completion candidates and byte-limits picks', () => {
  const raw = [
    { id: 'one', label: 'x'.repeat(100), detail: 'd'.repeat(200) },
    { id: 'one', label: 'duplicate' },
    null,
    { id: 2, label: 'bad' },
    ...Array.from({ length: 60 }, (_, i) => ({ id: String(i), label: 'ok' })),
  ];
  const items = normalizeCandidates('a.b', 'demo', raw);
  expect(items).toHaveLength(50);
  expect(items[0].item.label).toHaveLength(64);
  expect(items[0].item.detail).toHaveLength(120);
  expect(new Set(items.map((item) => item.key)).size).toBe(50);
  expect(normalizePick({ text: '/literal' })).toBe('/literal');
  expect(normalizePick('字'.repeat(12000))).toBeNull();
  expect(normalizePick({ text: 1 })).toBeNull();
});
