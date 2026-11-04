import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it } from 'vitest';
import {
  type EnginePidRecord,
  EnginePidRegistry,
  engineProcessArgs,
  engineWatchdogImport,
  isRecordedEngineCommand,
  parseEnginePidRecord,
} from './orphans';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const token = '11111111-1111-4111-8111-111111111111';
const engineBase = '/tmp/enso data/design/engine';
const record = {
  version: 1,
  pid: 12345,
  parentPid: 222,
  token,
  engineRoot: `${engineBase}/${'a'.repeat(20)}`,
  port: 3210,
} satisfies EnginePidRecord;
const args = (entry = record) => [
  '--import',
  engineWatchdogImport(entry.parentPid, entry.token),
  path.join(entry.engineRoot, 'node_modules/vite/bin/vite.js'),
  '--host',
  '127.0.0.1',
  '--port',
  String(entry.port),
  '--strictPort',
  '--clearScreen',
  'false',
];
it('PID 文件严格校验版本/端口/身份/物化根；命令必须匹配 exact watchdog nonce 和 Vite 启动参数', () => {
  expect(parseEnginePidRecord(record, engineBase)).toEqual(record);
  for (const bad of [
    null,
    { ...record, pid: 1 },
    { ...record, pid: 2.5 },
    { ...record, parentPid: 0 },
    { ...record, port: 0 },
    { ...record, token: 'bad' },
    { ...record, engineRoot: '/other/a' },
    { ...record, engineRoot: `${engineBase}/../a` },
    { ...record, extra: true },
  ])
    expect(parseEnginePidRecord(bad, engineBase)).toBeNull();
  const command = `/Applications/Enso Code.app/Contents/MacOS/Electron ${args().join(' ')}`;
  expect(isRecordedEngineCommand(record, command)).toBe(true);
  for (const bad of [
    command.replace(token, 'bad'),
    command.replace('--strictPort', '--notStrict'),
    command.replace('127.0.0.1', '0.0.0.0'),
    'node unrelated.js',
    `${command} --other`,
    command.replace(
      args()[1],
      engineWatchdogImport(record.parentPid, '22222222-2222-4222-8222-222222222222')
    ),
  ])
    expect(isRecordedEngineCommand(record, bad)).toBe(false);
  expect(decodeURIComponent(engineWatchdogImport(222, token))).not.toMatch(
    /require\(|require\.resolve\(|__dirname|__filename/
  );
});
it('PID 复用到无关进程不发信号；坏文件/链接不跟随，记录增删可观察', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-pids-'));
  temps.push(dir);
  const registry = new EnginePidRegistry(path.join(dir, 'engine'));
  const entry = { ...record, engineRoot: path.join(dir, 'engine', 'a'.repeat(20)) };
  registry.add(entry);
  expect(
    JSON.parse(await readFile(path.join(registry.directory, `${token}.json`), 'utf8'))
  ).toEqual(entry);
  const killed: number[] = [];
  registry.cleanup(
    () => ({ command: 'node unrelated.js', group: entry.pid }),
    (pid) => killed.push(pid)
  );
  expect(killed).toEqual([]);
  expect(await readdir(registry.directory)).toEqual([]);
  registry.add(entry);
  registry.cleanup(
    () => ({ command: `node ${args(entry).join(' ')}`, group: entry.pid + 1 }),
    (pid) => killed.push(pid)
  );
  expect(killed).toEqual([]);
  registry.add(entry);
  registry.cleanup(
    () => ({ command: `node ${args(entry).join(' ')}`, group: entry.pid }),
    (pid) => killed.push(pid)
  );
  expect(killed).toEqual([entry.pid]);
  const unrelated = path.join(dir, 'outside.json');
  await writeFile(unrelated, JSON.stringify(entry));
  // Unprivileged Windows cannot create file symlinks; the dead-record path still runs there.
  await symlink(unrelated, path.join(registry.directory, `${token}.json`)).catch(
    (error: NodeJS.ErrnoException) => {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    }
  );
  await writeFile(path.join(registry.directory, 'dead.json'), '{invalid');
  registry.cleanup(
    () => ({ command: `node ${args(entry).join(' ')}`, group: entry.pid }),
    (pid) => killed.push(pid)
  );
  expect(killed).toEqual([entry.pid]);
  expect(await readdir(registry.directory)).toEqual([]);
  expect(JSON.parse(await readFile(unrelated, 'utf8'))).toEqual(entry);
});
it('SIGKILL 父进程后 watchdog 回收独立进程组', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-orphan-live-'));
  temps.push(dir);
  const root = path.join(dir, 'engine', 'a'.repeat(20));
  await mkdir(path.join(root, 'node_modules/vite/bin'), { recursive: true });
  await writeFile(
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'console.log("ready");setInterval(()=>{},1000)'
  );
  const parentFile = path.join(dir, 'parent.mjs');
  // Use exactly the import module shipped in Main, injected into the child without changing Vite.
  await writeFile(
    parentFile,
    `import {spawn} from 'node:child_process'; const child=spawn(process.execPath, ['--import', ${JSON.stringify(engineWatchdogImport(0, token))}.replace('parent%3D0%3B','parent%3D'+process.pid+'%3B'), ${JSON.stringify(path.join(root, 'node_modules/vite/bin/vite.js'))}], {detached:true,stdio:['ignore','pipe','ignore']}); child.stdout.once('data',()=>console.log(child.pid)); setInterval(()=>{},1000);`
  );
  const parent = spawn(process.execPath, [parentFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  const output = await once(parent.stdout!, 'data');
  const pid = Number(String(output[0]).trim());
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    expect(alive()).toBe(true);
    parent.kill('SIGKILL');
    await once(parent, 'exit');
    const deadline = Date.now() + 5000;
    while (alive() && Date.now() < deadline) await delay(50);
    expect(alive()).toBe(false);
  } finally {
    parent.kill('SIGKILL');
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
});
it.skipIf(process.platform === 'win32')(
  '启动清理用真实 ps 检查并终止已登记的独立进程组',
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'design-orphan-cleanup-'));
    temps.push(dir);
    const engineBase = path.join(dir, 'engine');
    const engineRoot = path.join(engineBase, 'a'.repeat(20));
    await mkdir(path.join(engineRoot, 'node_modules/vite/bin'), { recursive: true });
    await writeFile(
      path.join(engineRoot, 'node_modules/vite/bin/vite.js'),
      'console.log("ready");setInterval(()=>{},1000)'
    );
    const identity = { engineRoot, parentPid: process.pid, token, port: 3210 };
    const child = spawn(process.execPath, engineProcessArgs(identity), {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const exited = once(child, 'exit');
    try {
      await once(child.stdout!, 'data');
      const registry = new EnginePidRegistry(engineBase);
      registry.add({ ...identity, version: 1, pid: child.pid! });
      registry.cleanup();
      expect(await Promise.race([exited, delay(1000, ['timeout'])])).toEqual([null, 'SIGKILL']);
      expect(await readdir(registry.directory)).toEqual([]);
    } finally {
      child.kill('SIGKILL');
    }
  }
);
