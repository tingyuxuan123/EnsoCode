import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

it('uses the design fonts and 16px layout baseline, not a scaled-down desktop baseline', () => {
  expect(css).toContain('@import "@fontsource-variable/roboto"');
  expect(css).toContain('@import "@fontsource-variable/jetbrains-mono"');
  expect(css).toMatch(/--font-size-base:\s*16px/);
});

it('keeps the send action outside the white input capsule using stable composer slots', () => {
  expect(css).toMatch(/\[data-composer-appearance="phone"\][\s\S]*?margin-right:\s*56px/);
  expect(css).toContain('[data-composer-action-button]');
  expect(css).toContain('[data-composer-editor]');
});

it('matches system/splash edge colours to the actual PWA canvas instead of white', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')
  );
  expect(manifest.background_color).toBe('#f4f5f7');
  expect(manifest.theme_color).toBe('#f4f5f7');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).not.toContain('content="#ffffff"');
  expect(html).not.toContain('content="#252529"');
});
