import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { writePluginTesting } from './pluginTesting';

describe('插件零依赖测试桩', () => {
  it('记录宿主调用、提供配置和可调用处理器，不覆盖现有文件', async () => {
    const dir = await mkdtemp(join(await realpath(tmpdir()), 'collabra-plugin-testing-'));
    try {
      await writePluginTesting(dir);
      const { mountMain } = await import(
        /* @vite-ignore */ pathToFileURL(join(dir, 'enso-testing.mjs')).href
      );
      const mounted = await mountMain(
        async (enso: any) => {
          const config = await enso.config.get();
          enso.tools.register('read', async (_args: unknown, ctx: any) => {
            await ctx.progress('working');
            await enso.ui.status.update('status', { text: config.label });
            return 'done';
          });
          enso.events.on('model_select', (data: unknown) => data);
        },
        { config: { label: 'ready' } }
      );
      expect(await mounted.tool('read', {})).toBe('done');
      expect(mounted.calls).toContainEqual({
        api: 'ui.status.update',
        args: ['status', { text: 'ready' }],
      });
      expect(await mounted.fire('model_select', { modelId: 'test' })).toEqual({ modelId: 'test' });
      await writeFile(join(dir, 'test', 'main.test.mjs'), 'user test');
      await expect(writePluginTesting(dir)).rejects.toThrow();
      expect(await readFile(join(dir, 'test', 'main.test.mjs'), 'utf8')).toBe('user test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
