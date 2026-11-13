import { describe, expect, it } from 'vitest';
import { themeAssetsCss } from './assets';
import { rewriteThemeCssUrls, themeCssReferencesLocalImage } from './themeCss';
import { parseThemeFile } from './themeFile';
import { pluginThemeKey } from './themeKey';

const palette = {
  canvas: '#fff',
  surface: '#fff',
  sunken: '#eee',
  border: '#ddd',
  borderStrong: '#bbb',
  text: '#111',
  textMuted: '#555',
  textSubtle: '#888',
  accent: '#66f',
};
describe('插件主题边界', () => {
  it('素材CSS只命中固定锚点，状态与减少动态效果有独立fallback', () => {
    const css = themeAssetsCss({
      thinking: {
        src: 'plugin://running.gif',
        still: 'plugin://still.png',
        states: { error: 'plugin://error.png' },
      },
    });
    expect(css).toContain('[data-enso="thinking"]');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('data-enso-session="error"');
    expect(css).toContain('--enso-asset-thinking-still');
    expect(themeAssetsCss(undefined)).toBe('');
  });
  it('读取浅深色调色板，过滤能逃出CSS声明的token与坏资源', () => {
    const theme = parseThemeFile({
      light: palette,
      dark: palette,
      tokens: { light: { '--safe': '12px', '--escape': 'red;}body{display:none', unknown: 'red' } },
      assets: {
        thinking: { src: 'images/thinking.gif', still: 'images/still.png' },
        welcome: { src: '../escape.png' },
      },
    });
    expect(theme).toMatchObject({
      ok: true,
      tokens: { light: { '--safe': '12px' } },
      assets: { thinking: { src: 'images/thinking.gif' } },
    });
    if (!theme.ok) throw new Error(theme.error);
    expect(theme.tokens?.light).not.toHaveProperty('--escape');
    expect(theme.assets).not.toHaveProperty('welcome');
    expect(
      parseThemeFile({ light: { ...palette, accent: 'red;display:none' }, dark: palette }).ok
    ).toBe(false);
    expect(pluginThemeKey('local.demo', 'mint')).toBe('local.demo/mint');
  });
  it('CSS引用仅重写插件目录内相对路径，并识别转义的local-image', () => {
    expect(
      rewriteThemeCssUrls(
        'a{background:url(../images/a.png)}',
        'themes/style.css',
        (rel) => `plugin:${rel}`
      )
    ).toContain('url("plugin:images/a.png")');
    expect(
      rewriteThemeCssUrls(
        'a{background:url(../../secret.png)}',
        'themes/style.css',
        (rel) => `plugin:${rel}`
      )
    ).not.toContain('plugin:');
    expect(themeCssReferencesLocalImage('url(l\\6f cal-image://posix/secret.png)')).toBe(true);
    expect(themeCssReferencesLocalImage('url(local%252dimage://posix/secret.png)')).toBe(true);
  });
});
