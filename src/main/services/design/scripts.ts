import type { ChildProcess } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DesignScriptRequest, DesignScriptResponse } from '@shared/types/design';
import { unzipSync } from 'fflate';
import { getDesignPaths } from './appPaths';
import { materializeEngine } from './engine';
import { DesignServiceError, isErrno, MAX_LIST_FILES, record, tooLarge } from './errors';
import { readBounded } from './files';
import { killGroup, runCommand, stopChild } from './process';
import { designDirectory } from './roots';
import { checkedPath, isRelativePath } from './security';

/** Fixed esbuild transform-only program, matching upstream SCAN_SCRIPT's RawSyntaxError[]. */
// Keep a space before the child loader's parentheses: electron-vite scans strings
// as well as code when deciding whether to inject its Main-only CommonJS shim.
export const SCAN_SCRIPT = `const fs=require ('fs'),p=require ('path'),esbuild=require (process.env.VETD_ESBUILD);
const dir=process.env.VETD_DIR,out=[],selected=JSON.parse(process.env.VETD_FILES||'[]');
let files=selected;
if(!files.length){files=[];for(const sub of ['frames','components']){let entries=[];try{entries=fs.readdirSync(p.join(dir,sub),{withFileTypes:true})}catch{continue}for(const e of entries)if(e.isFile()&&e.name.endsWith('.tsx'))files.push(sub+'/'+e.name)}}
for(const rel of files){let code;try{code=fs.readFileSync(p.join(dir,rel),'utf8')}catch{continue}
try{esbuild.transformSync(code,{loader:'tsx',sourcefile:rel})}catch(err){const first=err?.errors?.[0];const note=first?.notes?.[0]?.text?' '+first.notes[0].text:'';out.push({file:rel,line:first?.location?.line??null,message:(first?.text??String(err?.message??err))+note})}}
process.stdout.write(JSON.stringify(out));`;

async function assertRunnerTree(dir: string): Promise<void> {
  let count = 0;
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++count > 100000) tooLarge();
      const next = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new DesignServiceError(
          'OUT_OF_ROOT',
          'History does not accept symlinks in design sources'
        );
      if (
        entry.isDirectory() &&
        !['node_modules', '.snapshots', '.vetd-build'].includes(entry.name)
      )
        await walk(next);
    }
  };
  await walk(dir);
}
async function validateHistoryPack(dir: string, pack: string): Promise<void> {
  const bytes = await readBounded(pack, 24 * 1024 * 1024);
  let total = 0;
  let count = 0;
  unzipSync(bytes, {
    filter: (file) => {
      if (
        !isRelativePath(file.name) ||
        !file.name ||
        file.name.split('/').some((p) => p === '..' || p === '.')
      )
        throw new DesignServiceError('OUT_OF_ROOT', 'Invalid history archive path');
      total += file.originalSize;
      if (total > 64 * 1024 * 1024 || ++count > MAX_LIST_FILES) tooLarge();
      return false; // Validate headers only; runner is the only code that extracts.
    },
  });
  try {
    const info = await lstat(path.join(dir, '.history'));
    if (info.isSymbolicLink())
      throw new DesignServiceError('OUT_OF_ROOT', 'History symlink denied');
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
}
export class DesignScriptService {
  private readonly jobs = new Map<ChildProcess, number>();
  private readonly closed = new Set<number>();
  private disposed = false;
  async request(owner: number, request: DesignScriptRequest): Promise<DesignScriptResponse> {
    const dir = await designDirectory(request.root, request.designRel);
    if (this.jobs.size >= 8)
      throw new DesignServiceError('ENGINE_LIMIT', 'Too many design scripts');
    let child: ChildProcess | undefined;
    const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
      if (this.disposed || this.closed.has(owner))
        throw new DesignServiceError('ABORTED', 'Design owner closed');
      return runCommand(process.execPath, args, {
        cwd: dir,
        env: { ELECTRON_RUN_AS_NODE: '1', ...env },
        timeoutMs: request.script === 'history' ? 60000 : 15000,
        captureStdout: true,
        onChild: (c) => {
          child = c;
          this.jobs.set(c, owner);
        },
      });
    };
    try {
      await assertRunnerTree(dir);
      if (request.script === 'history') {
        const payload: Record<string, unknown> = { ...request.payload, dir };
        const pack = await checkedPath(dir, '.history-pack.zip');
        // Never forward renderer paths to the runner, even if payload mimics upstream absolute args.
        if (payload.cmd === 'pack') Object.assign(payload, { out: pack });
        if (payload.cmd === 'unpack') {
          Object.assign(payload, { from: pack });
          await validateHistoryPack(dir, pack);
        }
        const stdout = await run([getDesignPaths().historyRunner, JSON.stringify(payload)]);
        const result: unknown = JSON.parse(stdout.trim().split('\n').pop() ?? '');
        if (!record(result) || result.ok !== true)
          throw new DesignServiceError(
            'FAILED',
            record(result) && typeof result.error === 'string'
              ? result.error
              : 'History runner failed'
          );
        return { ok: true, result };
      }
      for (const file of request.files) await checkedPath(dir, file);
      const engine = await materializeEngine(getDesignPaths());
      const stdout = await run(['-e', SCAN_SCRIPT], {
        VETD_ESBUILD: path.join(engine.root, 'node_modules/esbuild'),
        VETD_DIR: dir,
        VETD_FILES: JSON.stringify(request.files),
      });
      const result: unknown = JSON.parse(stdout);
      return { ok: true, result: Array.isArray(result) ? result : [] };
    } finally {
      if (child) this.jobs.delete(child);
    }
  }
  releaseOwner(owner: number): void {
    this.closed.add(owner);
    for (const [child, id] of this.jobs) if (id === owner) void stopChild(child);
  }
  dispose(): void {
    this.disposed = true;
    for (const child of this.jobs.keys()) killGroup(child, 'SIGKILL');
  }
}
