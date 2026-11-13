// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { inlinePluginViewHtml, resolvePluginViewAsset } from './inlineAssets';

it('inlines package-relative script/style/image assets without permitting URL or path escapes', async () => {
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(() => {
    throw new Error('Must not parse into a resource-loading document');
  });
  expect(resolvePluginViewAsset('views/page.html', '../ui.js')).toBe('ui.js');
  for (const ref of ['../../escape.js', '/abs.js', 'https://evil.test/a.js', 'a.js?q', 'a\\b.js'])
    expect(resolvePluginViewAsset('views/page.html', ref)).toBeNull();
  const html = await inlinePluginViewHtml(
    '<script src="../ui.js"></script><link rel="stylesheet" href="style.css"><img src="icon.png">',
    'views/page.html',
    async (rel) => ({
      mime: rel.endsWith('.png') ? 'image/png' : 'text/plain',
      base64: btoa(rel.endsWith('.js') ? 'window.loaded=true' : 'body{color:red}'),
    })
  );
  expect(html).toContain('window.loaded=true');
  expect(html).toContain('<style>body{color:red}</style>');
  expect(html).toContain('data:image/png;base64,');
  expect(html).not.toContain('src="../ui.js"');
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
});
