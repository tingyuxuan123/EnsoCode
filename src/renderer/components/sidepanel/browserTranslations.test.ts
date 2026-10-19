import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BROWSER_DEVICE_CATEGORIES, BROWSER_DEVICE_PROFILES } from '@shared/browser/devices';
import { zhTranslations } from '@shared/i18n';
import { describe, expect, it, vi } from 'vitest';
import { BROWSER_STAGE_BACKGROUNDS } from './BrowserDeviceToolbar';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const files = [
  'BrowserView.tsx',
  'BrowserNewTab.tsx',
  'BrowserDeviceToolbar.tsx',
  'BrowserHistoryPanel.tsx',
  'BrowserDownloadsPanel.tsx',
  'BrowserRecords.tsx',
  'browserUi.ts',
];
const root = resolve(import.meta.dirname);
function translationKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(match[1]);
  for (const match of source.matchAll(
    /\b(?:title|detail|error|progressing|paused|completed|cancelled|interrupted):\s*'([^']+)'/g
  )) {
    if (match[1]) keys.add(match[1]);
  }
  return keys;
}

describe('browser UI translations', () => {
  it('provides Chinese translations for browser UI literals and helper errors', () => {
    for (const name of files) {
      for (const key of translationKeys(readFileSync(resolve(root, name), 'utf8')))
        expect(zhTranslations[key], `${name}: ${key}`).toBeTruthy();
    }
    for (const key of [
      'Stop loading',
      'Reload',
      'Viewport width',
      'Viewport height',
      'Desktop {{size}}',
      ...BROWSER_DEVICE_CATEGORIES.map((category) => category.name),
      ...BROWSER_STAGE_BACKGROUNDS.map((entry) => entry.label),
    ])
      expect(zhTranslations[key], key).toBeTruthy();
  });
  it('localizes device names that are not product names', () => {
    for (const name of ['Samsung Galaxy S20 Ultra', 'iPhone Duo outer', 'iPhone Duo inner']) {
      expect(BROWSER_DEVICE_PROFILES.some((profile) => profile.name === name)).toBe(true);
      expect(zhTranslations[name], name).toBeTruthy();
    }
  });
  it('does not introduce duplicate dictionary keys', () => {
    const source = readFileSync(resolve(root, '../../../shared/i18n.ts'), 'utf8');
    const names = Array.from(
      source.matchAll(/^ {2}(?:'([^']+)'|([A-Za-z][A-Za-z\d]*)):\s/gm),
      (match) => match[1] ?? match[2]
    );
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });
});
