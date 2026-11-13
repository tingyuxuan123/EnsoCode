import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 随插件分发的零依赖测试宿主；它不是权限或真实 Electron 集成验证。 */
export const PLUGIN_TESTING_SOURCE = `export async function mountMain(activate, options = {}) {
  const calls = [];
  const maps = Object.fromEntries(['tools','commands','events','schedules','methods','exports','triggers'].map(k => [k,new Map()]));
  const call = (api, args) => {
    calls.push({ api, args });
    if (typeof options.host?.[api] === 'function') return options.host[api](...args);
    if (api === 'config.get') return options.config ?? {};
  };
  const register = kind => (key, handler) => {
    const map = maps[kind];
    map.set(key, handler);
    return () => { if (map.get(key) === handler) map.delete(key); };
  };
  const api = name => (...args) => call(name, args);
  const enso = {
    pluginId: options.pluginId ?? 'test.plugin', dataDir: options.dataDir ?? '.',
    tools: { register: register('tools') }, commands: { register: register('commands') },
    events: { on: register('events') }, schedules: { register: register('schedules') },
    renderer: { handle: register('methods') }, exports: { handle: register('exports') },
    triggers: { register: register('triggers') },
    config: { get: api('config.get') },
    ui: { notify: api('ui.notify'), view: { emit: api('ui.view.emit'), open: api('ui.view.open') },
      status: { update: api('ui.status.update') }, clipboard: { writeText: api('ui.clipboard.writeText') },
      openExternal: api('ui.openExternal') },
    fs: { readText: api('fs.readText'), writeText: api('fs.writeText') },
    net: { fetch: api('net.fetch') }, artifacts: { write: api('artifacts.write') },
    session: Object.fromEntries(['messages','inject','abort','list','status','focus','create'].map(k => [k,api('session.'+k)])),
    composer: Object.fromEntries(['readDraft','insertText','replaceDraft'].map(k => [k,api('composer.'+k)])),
    mcp: { tools: api('mcp.tools'), call: api('mcp.call') },
    plugins: { call: api('plugins.call') }, host: { capabilities: api('host.capabilities') }
  };
  await activate(enso);
  const ctxOr = ctx => ctx ?? { sessionId: 'test-session', progress: async () => {} };
  const invoke = async (kind,key,args) => {
    const handler = maps[kind].get(key);
    if (typeof handler !== 'function') throw new Error('未注册: '+kind+' '+key);
    return await handler(...args);
  };
  return { enso,calls,
    tool: (name,args,ctx) => invoke('tools',name,[args,ctxOr(ctx)]),
    command: (id,ctx) => invoke('commands',id,[ctxOr(ctx)]),
    fire: (event,data,ctx) => invoke('events',event,[data,ctxOr(ctx)]),
    schedule: id => invoke('schedules',id,[ctxOr()]),
    method: (name,args,ctx) => invoke('methods',name,[args,ctxOr(ctx)]),
    exported: (name,args,ctx) => invoke('exports',name,[args,ctxOr(ctx)])
  };
}
`;
const EXAMPLE_TEST = `import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { activate } from '../main.mjs';
import { mountMain } from '../enso-testing.mjs';
test('activate registers without a real host', async () => {
  const mounted = await mountMain(activate);
  assert.ok(mounted.enso);
});
`;

export async function writePluginTesting(directory: string): Promise<void> {
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('测试桩目标必须是无符号链接的普通目录');
  const testDir = join(root, 'test');
  await mkdir(testDir, { recursive: true });
  const testInfo = await lstat(testDir);
  if (!testInfo.isDirectory() || testInfo.isSymbolicLink() || (await realpath(testDir)) !== testDir)
    throw new Error('测试目录不能是符号链接');
  const created: string[] = [];
  try {
    for (const [file, text] of [
      [join(root, 'enso-testing.mjs'), PLUGIN_TESTING_SOURCE],
      [join(testDir, 'main.test.mjs'), EXAMPLE_TEST],
    ]) {
      const handle = await open(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      created.push(file);
      try {
        await handle.writeFile(text);
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    for (const file of created) await rm(file);
    throw error;
  }
}
