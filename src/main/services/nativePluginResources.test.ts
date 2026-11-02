import { afterEach, expect, it, vi } from 'vitest';
import {
  ensureNativePluginResources,
  nativePluginResources,
  setNativePluginLoader,
  setNativePluginResources,
} from './nativePluginResources';

afterEach(() => setNativePluginResources(undefined));
it('缺服务的插件预设拒绝，普通会话空资源；已初始化才读取描述不启动插件', async () => {
  expect(nativePluginResources().tools).toEqual([]);
  expect(nativePluginResources('plugin:enso.example:review').preset).toMatchObject({ ok: false });
  const load = vi.fn(async () =>
    setNativePluginResources(() => ({
      tools: [],
      skillPaths: ['/fixture/plugin/skills'],
      mcpServers: [],
    }))
  );
  setNativePluginLoader(load);
  await Promise.all([ensureNativePluginResources(), ensureNativePluginResources()]);
  expect(load).toHaveBeenCalledOnce();
  expect(nativePluginResources().skillPaths).toEqual(['/fixture/plugin/skills']);
});
