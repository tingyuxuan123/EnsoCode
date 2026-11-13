// @vitest-environment happy-dom
import { ACCENT_COLORS } from '@shared/accentColor';
import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  theme: 'light',
  lightPalette: 'mint-light',
  accentColor: 'ocean',
  pluginTheme: '',
  terminalTheme: 'Dracula',
  terminalFontSize: 14,
  terminalFontFamily: 'monospace',
  terminalFontWeight: 'normal',
  terminalFontWeightBold: '500',
  favoriteTerminalThemes: [],
  setAccentColor: vi.fn(),
  backgroundImageEnabled: false,
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
vi.mock('@/stores/settings', () => ({
  ACCENT_COLORS,
  useSettingsStore: (select?: (s: typeof state) => unknown) => (select ? select(state) : state),
}));
vi.mock('@/stores/pluginThemes', () => ({ usePluginThemesStore: () => [] }));
vi.mock('./ChatTypographySettings', () => ({ ChatTypographySettings: () => null }));

import { AppearanceSettings } from './AppearanceSettings';

describe('light palette accent selection', () => {
  it.each(['ocean', 'mint-light', 'cloud-light'])(
    '%s keeps every accent choice interactive',
    (palette) => {
      state.lightPalette = palette;
      const doc = parseHTML(renderToStaticMarkup(createElement(AppearanceSettings))).document;
      for (const label of ['Ocean', 'Indigo', 'Violet', 'Teal', 'Amber', 'Graphite']) {
        const button = doc.querySelector(`button[aria-label="${label}"]`);
        expect(button, label).not.toBeNull();
        expect(button?.hasAttribute('disabled'), `${palette}/${label}`).toBe(false);
      }
      expect(doc.body.textContent).not.toContain('uses its own');
    }
  );
});
