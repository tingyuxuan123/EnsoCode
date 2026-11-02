import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  DesignEngineProgressEvent,
  DesignEngineRequest,
  DesignEngineResponse,
  DesignEngineStatus,
  DesignRootRef,
} from '@shared/types/design';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { hydrateShellPath } from '../shellPath';
import { getDesignPaths } from './appPaths';
import { DesignServiceError, isErrno, record } from './errors';
import { readBounded } from './files';
import type { DesignResourcePaths } from './paths';
import {
  allocateFreePort,
  commandEnvironment,
  killGroup,
  OutputTail,
  runCommand,
  stopChild,
} from './process';
import { designDirectory, resolveDesignRoot } from './roots';
import { checkedPath, contained, isRelativePath } from './security';

const materializing = new Map<string, Promise<{ root: string; version: string }>>();
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false;
    throw error;
  }
}
export async function materializeEngine(
  paths: DesignResourcePaths
): Promise<{ root: string; version: string }> {
  if (!(await exists(path.join(paths.engineTemplate, 'node_modules/vite/bin/vite.js'))))
    throw new DesignServiceError(
      'ENGINE_UNAVAILABLE',
      'Design engine dependencies are missing; run pnpm design:prepare'
    );
  const hash = createHash('sha256');
  const hashTree = async (dir: string, rel = '') => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const sub = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) await hashTree(path.join(dir, entry.name), sub);
      else if (entry.isFile()) {
        hash.update(sub);
        hash.update(await readBounded(path.join(dir, entry.name)));
      }
    }
  };
  try {
    await hashTree(paths.engineTemplate);
  } catch {
    throw new DesignServiceError(
      'ENGINE_UNAVAILABLE',
      'Design engine template unavailable; run pnpm design:prepare'
    );
  }
  const version = hash.digest('hex').slice(0, 20);
  const root = path.join(paths.engineBase, version);
  const existing = materializing.get(root);
  if (existing) return existing;
  const work = (async () => {
    if (await exists(path.join(root, 'node_modules/vite/bin/vite.js'))) return { root, version };
    await mkdir(paths.engineBase, { recursive: true });
    const container = await mkdtemp(path.join(paths.engineBase, '.staging-'));
    const staging = path.join(container, 'engine');
    try {
      await cp(paths.engineTemplate, staging, {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      });
      await rename(staging, root);
    } catch (error) {
      if (!isErrno(error, 'EEXIST') && !isErrno(error, 'ENOTEMPTY')) throw error;
    } finally {
      await rm(container, { recursive: true, force: true });
    }
    return { root, version };
  })();
  materializing.set(root, work);
  try {
    return await work;
  } finally {
    materializing.delete(root);
  }
}
export function validBuildOutput(designRel: string, outRel: string): boolean {
  return (
    isRelativePath(designRel) &&
    isRelativePath(outRel) &&
    path.posix.normalize(outRel) === path.posix.join(designRel, '.vetd-build')
  );
}
export async function findNpm(): Promise<string | null> {
  await hydrateShellPath();
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next PATH entry */
    }
  }
  return null;
}
interface Engine {
  id: string;
  dir: string;
  port: number;
  owners: Set<number>;
  audience: Set<number>;
  child: ChildProcess;
  output: OutputTail;
  exit?: { exitCode: number | null; signal: string | null };
}
interface Starting {
  owners: Set<number>;
  promise: Promise<Engine>;
}
export class DesignEngineService {
  private readonly engines = new Map<string, Engine>();
  private readonly starting = new Map<string, Starting>();
  private readonly jobs = new Map<ChildProcess, number>();
  private readonly closedOwners = new Set<number>();
  private disposed = false;
  constructor(private readonly send: (owner: number, channel: string, event: unknown) => void) {}
  private assertOwner(owner: number): void {
    if (this.disposed || this.closedOwners.has(owner))
      throw new DesignServiceError('ABORTED', 'Design owner closed');
  }
  registered(owner: number, engineId: string): { port: number } | null {
    const e = this.engines.get(engineId);
    return e && !e.exit && e.owners.has(owner) && !this.closedOwners.has(owner)
      ? { port: e.port }
      : null;
  }
  private owned(owner: number, id: string): Engine {
    const e = this.engines.get(id);
    if (!e?.audience.has(owner))
      throw new DesignServiceError('NOT_FOUND', 'Design engine not found');
    return e;
  }
  private progress(
    owners: Set<number>,
    root: DesignRootRef,
    designRel: string,
    phase: DesignEngineProgressEvent['phase'],
    outputTail?: string
  ): void {
    for (const owner of owners)
      this.send(owner, IPC_CHANNELS.DESIGN_ENGINE_PROGRESS, {
        root,
        designRel,
        phase,
        ...(outputTail ? { outputTail } : {}),
      });
  }
  async request(owner: number, request: DesignEngineRequest): Promise<DesignEngineResponse> {
    this.assertOwner(owner);
    if (request.op === 'diagnostics') {
      const engine = await materializeEngine(getDesignPaths());
      return {
        ok: true,
        engineVersion: engine.version,
        engineRoot: engine.root,
        npm: await findNpm(),
      };
    }
    if (request.op === 'status') {
      const e = this.owned(owner, request.engineId);
      const status: DesignEngineStatus = {
        engineId: e.id,
        running: !e.exit,
        port: e.port,
        recentOutput: e.output.text(),
        ...(e.exit ? { exit: e.exit } : {}),
      };
      return { ok: true, status };
    }
    if (request.op === 'stop') {
      const e = this.owned(owner, request.engineId);
      e.owners.delete(owner);
      if (!e.owners.size) await stopChild(e.child);
      return { ok: true };
    }
    const dir = await designDirectory(request.root, request.designRel);
    this.assertOwner(owner);
    if (request.op === 'start') {
      let start = this.starting.get(dir);
      const live =
        !start &&
        [...this.engines.values()].find((e) => e.dir === dir && !e.exit && e.owners.size > 0);
      if (live) {
        live.owners.add(owner);
        live.audience.add(owner);
        return {
          ok: true,
          engineId: live.id,
          port: live.port,
          origin: `http://127.0.0.1:${live.port}`,
        };
      }
      if (!start) {
        const activeDirs = new Set(
          [...this.engines.values()].filter((e) => !e.exit).map((e) => e.dir)
        );
        for (const pendingDir of this.starting.keys()) activeDirs.add(pendingDir);
        if (activeDirs.size >= 8)
          throw new DesignServiceError('ENGINE_LIMIT', 'At most 8 design engines can run');
        const owners = new Set([owner]);
        const promise = this.start(dir, owners, request.root, request.designRel).finally(() =>
          this.starting.delete(dir)
        );
        start = { owners, promise };
        this.starting.set(dir, start);
      } else start.owners.add(owner);
      const e = await start.promise;
      this.assertOwner(owner);
      e.audience.add(owner);
      return { ok: true, engineId: e.id, port: e.port, origin: `http://127.0.0.1:${e.port}` };
    }
    const owners = new Set([owner]);
    if (request.op === 'install') {
      const output = await this.install(owner, dir, request.packages ?? [], (tail) =>
        this.progress(owners, request.root, request.designRel, 'installing', tail)
      );
      return { ok: true, output };
    }
    if (!validBuildOutput(request.designRel, request.outRel))
      throw new DesignServiceError(
        'PERMISSION_DENIED',
        'Build output must be the design .vetd-build directory'
      );
    const root = (await resolveDesignRoot(request.root)).path;
    const out = await checkedPath(root, request.outRel, true);
    if (!contained(dir, out) || path.relative(dir, out) !== '.vetd-build')
      throw new DesignServiceError('OUT_OF_ROOT', 'Build output symlink is not allowed');
    const engine = await materializeEngine(getDesignPaths());
    await this.ensureDependencies(owner, dir, () => {});
    this.assertOwner(owner);
    return {
      ok: true,
      output: await this.job(
        owner,
        process.execPath,
        ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir'],
        engine.root,
        { ELECTRON_RUN_AS_NODE: '1', VETD_SRC: dir },
        120000
      ),
    };
  }
  private async job(
    owner: number,
    file: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    onOutput?: (tail: string) => void
  ): Promise<string> {
    this.assertOwner(owner);
    if (this.jobs.size >= 8)
      throw new DesignServiceError('ENGINE_LIMIT', 'Too many design commands');
    let child: ChildProcess | undefined;
    try {
      return await runCommand(file, args, {
        cwd,
        env,
        timeoutMs,
        onOutput,
        onChild: (c) => {
          child = c;
          this.jobs.set(c, owner);
        },
      });
    } finally {
      if (child) this.jobs.delete(child);
    }
  }
  private async install(
    owner: number,
    dir: string,
    packages: string[],
    output: (tail: string) => void
  ): Promise<string> {
    const npm = await findNpm();
    if (!npm)
      throw new DesignServiceError(
        'NPM_UNAVAILABLE',
        'Install Node.js to make npm available for design dependencies'
      );
    if (!(await exists(path.join(dir, 'package.json'))))
      await writeFile(
        await checkedPath(dir, 'package.json'),
        JSON.stringify(
          { name: 'vetta-design', private: true, version: '1.0.0', dependencies: {} },
          null,
          2
        )
      );
    await checkedPath(dir, 'package.json');
    await checkedPath(dir, 'package-lock.json');
    await checkedPath(dir, 'node_modules');
    return this.job(
      owner,
      npm,
      ['install', ...packages, '--no-audit', '--no-fund'],
      dir,
      {},
      600000,
      output
    );
  }
  private async ensureDependencies(
    owner: number,
    dir: string,
    output: (tail: string) => void
  ): Promise<void> {
    let pkg: unknown;
    try {
      pkg = JSON.parse(
        (await readBounded(await checkedPath(dir, 'package.json'), 1024 * 1024)).toString('utf8')
      );
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return;
      throw error;
    }
    if (!record(pkg) || !record(pkg.dependencies)) return;
    for (const name of Object.keys(pkg.dependencies)) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name))
        throw new DesignServiceError('INVALID_ARGUMENT', 'Invalid design dependency name');
      if (!(await exists(await checkedPath(dir, `node_modules/${name}/package.json`)))) {
        await this.install(owner, dir, [], output);
        return;
      }
    }
  }
  private async start(
    dir: string,
    owners: Set<number>,
    root: DesignRootRef,
    designRel: string
  ): Promise<Engine> {
    const owner = () => {
      const id = [...owners].find((id) => !this.closedOwners.has(id));
      if (id === undefined || this.disposed)
        throw new DesignServiceError('ABORTED', 'Design owner closed');
      return id;
    };
    let e: Engine | undefined;
    try {
      this.progress(owners, root, designRel, 'materializing');
      const engine = await materializeEngine(getDesignPaths());
      await this.ensureDependencies(owner(), dir, (tail) =>
        this.progress(owners, root, designRel, 'installing', tail)
      );
      const port = await allocateFreePort();
      owner();
      this.progress(owners, root, designRel, 'starting');
      const child = spawn(
        process.execPath,
        [
          'node_modules/vite/bin/vite.js',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
          '--clearScreen',
          'false',
        ],
        {
          cwd: engine.root,
          env: commandEnvironment({ ELECTRON_RUN_AS_NODE: '1', VETD_SRC: dir }),
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }
      );
      e = {
        id: randomUUID(),
        dir,
        port,
        owners,
        audience: new Set(owners),
        child,
        output: new OutputTail(),
      };
      const entry = e;
      this.engines.set(entry.id, entry);
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk: Buffer) => entry.output.append(chunk));
      const exited = new Promise<never>((_resolve, reject) => {
        child.once('error', (error) => {
          entry.exit = { exitCode: null, signal: null };
          reject(error);
        });
        child.once('exit', (exitCode, signal) => {
          entry.exit = { exitCode, signal };
          for (const id of entry.audience)
            this.send(id, IPC_CHANNELS.DESIGN_ENGINE_EXIT, {
              engineId: entry.id,
              exitCode,
              signal,
            });
          const cleanup = setTimeout(() => this.engines.delete(entry.id), 5 * 60000);
          cleanup.unref();
          reject(
            new DesignServiceError(
              'FAILED',
              `Design engine exited ${exitCode ?? signal}\n${entry.output.text()}`
            )
          );
        });
      });
      const ready = async () => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          owner();
          if (entry.exit) throw new DesignServiceError('FAILED', entry.output.text());
          try {
            const response = await fetch(`http://127.0.0.1:${port}/`, {
              signal: AbortSignal.timeout(1000),
              redirect: 'manual',
            });
            await response.body?.cancel();
            if (response.ok) return;
          } catch {
            /* not listening yet */
          }
          await delay(150);
        }
        throw new DesignServiceError(
          'TIMEOUT',
          `Design engine did not become ready\n${entry.output.text()}`
        );
      };
      await Promise.race([ready(), exited]);
      this.progress(owners, root, designRel, 'ready');
      return entry;
    } catch (error) {
      if (e) await stopChild(e.child);
      this.progress(
        owners,
        root,
        designRel,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  releaseOwner(owner: number): void {
    this.closedOwners.add(owner);
    for (const pending of this.starting.values()) pending.owners.delete(owner);
    for (const e of this.engines.values()) {
      e.owners.delete(owner);
      e.audience.delete(owner);
      if (!e.owners.size && !e.exit) void stopChild(e.child);
    }
    for (const [child, id] of this.jobs) if (id === owner) void stopChild(child);
  }
  dispose(): void {
    this.disposed = true;
    // will-quit cannot wait three seconds: use a final synchronous process-group sweep.
    for (const e of this.engines.values()) if (!e.exit) killGroup(e.child, 'SIGKILL');
    for (const child of this.jobs.keys()) killGroup(child, 'SIGKILL');
  }
}
