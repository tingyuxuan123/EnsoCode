// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { observePluginTheme, readPluginTheme } from './themeBridge';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('class');
  delete document.documentElement.dataset.accent;
  delete document.documentElement.dataset.lightPalette;
  vi.restoreAllMocks();
});

it('captures actual custom palette and typography tokens instead of guessing a light/dark palette', () => {
  const root = document.documentElement;
  root.style.setProperty('--background', '#123456');
  root.style.setProperty('--primary', 'rgb(250 90 20)');
  root.style.setProperty('--font-size-base', '16px');
  root.style.setProperty('--font-family-sans', '"Inter Variable", system-ui');
  root.style.setProperty('--private-path', 'secret');
  root.style.setProperty('--card', 'url(https://untrusted.invalid/private)');
  expect(readPluginTheme(document)).toMatchObject({
    theme: 'light',
    variables: {
      '--background': '#123456',
      '--primary': 'rgb(250 90 20)',
      '--font-size-base': '16px',
      '--font-family-sans': '"Inter Variable", system-ui',
    },
  });
  expect(readPluginTheme(document).variables).not.toHaveProperty('--private-path');
  expect(readPluginTheme(document).variables).not.toHaveProperty('--card');
});

it('syncs same-mode accent, light palette, custom stylesheet and font changes and disposes observers', async () => {
  const push = vi.fn();
  const stop = observePluginTheme(document, push);
  document.documentElement.style.setProperty('--primary', '#ed6700');
  document.documentElement.dataset.accent = 'orange';
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(push).toHaveBeenLastCalledWith(
    expect.objectContaining({
      theme: 'light',
      variables: expect.objectContaining({ '--primary': '#ed6700' }),
    })
  );
  const stylesheet = document.createElement('style');
  document.head.append(stylesheet);
  document.documentElement.style.setProperty('--font-size-base', '18px');
  stylesheet.textContent = ':root { --card: #ddeeff; }';
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(push.mock.lastCall?.[0].variables['--font-size-base']).toBe('18px');
  const count = push.mock.calls.length;
  stop();
  document.documentElement.style.setProperty('--primary', '#000000');
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(push).toHaveBeenCalledTimes(count);
  stylesheet.remove();
});
