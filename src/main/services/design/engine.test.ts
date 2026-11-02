import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { designResourcePaths } from './paths';

vi.mock('./appPaths', () => ({ getDesignPaths: vi.fn() }));

import { getDesignPaths } from './appPaths';
import { DesignEngineService, materializeEngine, validBuildOutput } from './engine';
import { designDirectory } from './roots';

vi.mock('./roots', () => ({ designDirectory: vi.fn(), resolveDesignRoot: vi.fn() }));

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('未预装依赖时给出 prepare 提示，不隐式联网安装引擎', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-engine-'));
  temps.push(dir);
  const paths = designResourcePaths({
    packaged: false,
    appPath: dir,
    resourcesPath: dir,
    userDataPath: path.join(dir, 'data'),
  });
  await mkdir(paths.engineTemplate, { recursive: true });
  await writeFile(path.join(paths.engineTemplate, 'package-lock.json'), '{}');
  await expect(materializeEngine(paths)).rejects.toMatchObject({
    code: 'ENGINE_UNAVAILABLE',
    message: expect.stringContaining('pnpm design:prepare'),
  });
});
it('并发物化复用且模板内容变化会升级目录，不改旧引擎', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-engine-'));
  temps.push(dir);
  const paths = designResourcePaths({
    packaged: false,
    appPath: dir,
    resourcesPath: dir,
    userDataPath: path.join(dir, 'data'),
  });
  await mkdir(path.join(paths.engineTemplate, 'node_modules/vite/bin'), { recursive: true });
  await writeFile(path.join(paths.engineTemplate, 'node_modules/vite/bin/vite.js'), 'vite');
  await symlink('bin/vite.js', path.join(paths.engineTemplate, 'node_modules/vite/cli'));
  await writeFile(path.join(paths.engineTemplate, 'package-lock.json'), '{}');
  const [a, b] = await Promise.all([materializeEngine(paths), materializeEngine(paths)]);
  expect(a).toEqual(b);
  expect(await readlink(path.join(a.root, 'node_modules/vite/cli'))).toBe('bin/vite.js');
  await writeFile(path.join(paths.engineTemplate, 'package-lock.json'), '{"version":2}');
  const c = await materializeEngine(paths);
  expect(c.root).not.toBe(a.root);
  expect(await readFile(path.join(a.root, 'package-lock.json'), 'utf8')).toBe('{}');
});
it('build 不能 emptyOutDir 擦掉设计包或普通项目路径', () => {
  expect(validBuildOutput('a.vetd', 'a.vetd/.vetd-build')).toBe(true);
  expect(validBuildOutput('a.vetd', 'a.vetd')).toBe(false);
  expect(validBuildOutput('a.vetd', 'a.vetd/frames')).toBe(false);
  expect(validBuildOutput('a.vetd', '../dist')).toBe(false);
});
it('并发 start 等同一就绪信号再复用，停一个 owner 不影响另一个', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-engine-live-'));
  temps.push(dir);
  const paths = designResourcePaths({
    packaged: false,
    appPath: dir,
    resourcesPath: dir,
    userDataPath: path.join(dir, 'data'),
  });
  await mkdir(path.join(paths.engineTemplate, 'node_modules/vite/bin'), { recursive: true });
  await writeFile(path.join(paths.engineTemplate, 'package-lock.json'), '{}');
  await writeFile(
    path.join(paths.engineTemplate, 'node_modules/vite/bin/vite.js'),
    `const http=require('http');const args=process.argv;const port=Number(args[args.indexOf('--port')+1]);setTimeout(()=>http.createServer((_,r)=>r.end('ready')).listen(port,'127.0.0.1'),250);`
  );
  const design = path.join(dir, 'a.vetd');
  await mkdir(design);
  vi.mocked(getDesignPaths).mockReturnValue(paths);
  vi.mocked(designDirectory).mockResolvedValue(design);
  const starting = Promise.withResolvers<void>();
  const service = new DesignEngineService((_owner, _channel, event) => {
    if (event && typeof event === 'object' && 'phase' in event && event.phase === 'starting')
      starting.resolve();
  });
  try {
    const first = service.request(1, {
      op: 'start',
      root: { kind: 'project', projectId: 'p' },
      designRel: 'a.vetd',
    });
    await starting.promise;
    let secondReady = false;
    const second = service
      .request(2, { op: 'start', root: { kind: 'project', projectId: 'p' }, designRel: 'a.vetd' })
      .then((value) => {
        secondReady = true;
        return value;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(secondReady).toBe(false);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    if (!('engineId' in a)) throw new Error('No engine');
    await service.request(1, { op: 'stop', engineId: a.engineId });
    expect(service.registered(2, a.engineId)).not.toBeNull();
    await service.request(2, { op: 'stop', engineId: a.engineId });
    expect(service.registered(2, a.engineId)).toBeNull();
    expect(await service.request(2, { op: 'status', engineId: a.engineId })).toMatchObject({
      status: { running: false },
    });
  } finally {
    service.dispose();
  }
});
