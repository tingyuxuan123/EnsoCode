import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guard for persistent state branches, not transient menu highlights.
// Both branches are checked: hover must not become a second selected state.
const cases = [
  ['./SettingsContent.tsx', /activeCategory === category.id\s*\? '([^']+)'\s*: '([^']+)'/],
  ['./AppearanceSettings.tsx', /theme === option.value\s*\? '([^']+)'\s*: '([^']+)'/],
  ['./ProviderModelRow.tsx', /selected\s*\? '([^']*(?:font-medium)[^']*)'\s*: '([^']+)'/],
  ['../sidepanel/FilesView.tsx', /doc.rel === activeRel\s*\? '([^']+)'\s*: '([^']+)'/],
  [
    '../../features/imageStudio/ImageStudio.tsx',
    /activeId === item.id\s*\? '([^']+)'\s*: '([^']+)'/,
  ],
  ['../bots/BotBrowserPanel.tsx', /tabId === active\s*\? '([^']+)'\s*: '([^']+)'/],
] as const;

describe('persistent business selection', () => {
  it.each(cases)('%s separates selected fill from neutral hover', (path, branch) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const match = source.match(branch);
    expect(match, 'persistent active/inactive branch must remain auditable').not.toBeNull();
    const active = match?.[1].split(/\s+/) ?? [];
    const inactive = match?.[2].split(/\s+/) ?? [];
    expect(active).toContain('bg-selection');
    expect(active).toContain('text-selection-foreground');
    expect(
      active.filter((token) => /^bg-(accent|muted|primary|brand|background)(\/|$)/.test(token))
    ).toEqual([]);
    expect(inactive.some((token) => token.includes('selection'))).toBe(false);
    expect(inactive.some((token) => token.startsWith('hover:'))).toBe(true);
    if (path.includes('Appearance')) expect(active).toContain('border-selection-border');
  });
});
