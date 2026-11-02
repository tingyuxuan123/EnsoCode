import { readFile } from 'node:fs/promises';
import { parseExtensionPluginManifest } from '@shared/extensionPlugins/manifest';
import { expect, it } from 'vitest';

it('word stats computes Unicode characters, words and lines without filesystem or network access', async () => {
  const file = new URL('../../../examples/plugins/word-stats/main.mjs', import.meta.url);
  const { analyze } = await import(/* @vite-ignore */ file.href);
  expect(analyze('hello hello\n世界')).toEqual({ words: 3, lines: 2, chars: 14 });
  expect(analyze('')).toEqual({ words: 0, lines: 0, chars: 0 });
});
it('example manifests parse and request no network or MCP access', async () => {
  for (const name of ['word-stats', 'snippets', 'notes']) {
    const json = await readFile(
      new URL(`../../../examples/plugins/${name}/enso-plugin.json`, import.meta.url),
      'utf8'
    );
    const result = parseExtensionPluginManifest(JSON.parse(json), '0.2.37');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.permissions).not.toContain('net.fetch');
      expect(result.manifest.permissions).not.toContain('mcp.call');
      expect(result.manifest.net.domains).toEqual([]);
    }
  }
});
