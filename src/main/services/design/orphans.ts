import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export interface EnginePidRecord {
  version: 1;
  pid: number;
  parentPid: number;
  token: string;
  engineRoot: string;
  port: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const pid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 1 && value <= 0x7fffffff;
export function parseEnginePidRecord(value: unknown, engineBase: string): EnginePidRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'engineRoot,parentPid,pid,port,token,version' ||
    v.version !== 1 ||
    !pid(v.pid) ||
    !pid(v.parentPid) ||
    typeof v.token !== 'string' ||
    !uuid.test(v.token) ||
    typeof v.engineRoot !== 'string' ||
    !path.isAbsolute(v.engineRoot) ||
    path.dirname(v.engineRoot) !== engineBase ||
    !/^[a-f0-9]{20}$/.test(path.basename(v.engineRoot)) ||
    typeof v.port !== 'number' ||
    !Number.isInteger(v.port) ||
    v.port < 1 ||
    v.port > 65535
  )
    return null;
  return {
    version: 1,
    pid: v.pid,
    parentPid: v.parentPid,
    token: v.token,
    engineRoot: v.engineRoot,
    port: v.port,
  };
}
/** Node's --import runs before Vite without touching its config or source. Unref leaves normal exit alone.
 * Reparenting also detects the old parent PID being reused; group KILL includes Vite's esbuild children. */
export function engineWatchdogImport(parentPid: number, token: string): string {
  const script = `const parent=${parentPid};const marker=${JSON.stringify(token)};const check=()=>{let gone=process.ppid!==parent;try{process.kill(parent,0)}catch(e){if(e.code==='ESRCH')gone=true}if(gone){try{process.kill(process.platform==='win32'?process.pid:-process.pid,'SIGKILL')}catch{}process.exit(0)}};setInterval(check,500).unref();check();`;
  return `data:text/javascript,${encodeURIComponent(script)}`;
}
export function engineProcessArgs(entry: Omit<EnginePidRecord, 'version' | 'pid'>): string[] {
  return [
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
}
export function isRecordedEngineCommand(entry: EnginePidRecord, command: string): boolean {
  return command.trim().endsWith(` ${engineProcessArgs(entry).join(' ')}`);
}
function inspectProcess(processId: number): { command: string; group: number } | null {
  // Fail closed on platforms without POSIX ps/process groups; the in-process watchdog still applies.
  if (process.platform === 'win32') return null;
  try {
    const options = { encoding: 'utf8' as const, timeout: 2000, maxBuffer: 65536 };
    const output = execFileSync(
      '/bin/ps',
      ['-ww', '-p', String(processId), '-o', 'pgid=', '-o', 'args='],
      options
    );
    const match = output.trim().match(/^(\d+)\s+(.+)$/s);
    return match ? { group: Number(match[1]), command: match[2] } : null;
  } catch {
    return null;
  }
}
export class EnginePidRegistry {
  readonly directory: string;
  constructor(private readonly engineBase: string) {
    this.directory = path.join(path.dirname(engineBase), 'engine-pids');
  }
  add(entry: EnginePidRecord): void {
    if (!parseEnginePidRecord(entry, this.engineBase))
      throw new Error('Invalid design engine PID record');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${entry.token}.json`);
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(entry), { mode: 0o600 });
    renameSync(temp, file);
  }
  remove(token: string): void {
    if (!uuid.test(token)) return;
    try {
      rmSync(path.join(this.directory, `${token}.json`), { force: true });
    } catch {
      /* A stale record will be revalidated on startup. */
    }
  }
  cleanup(
    inspect = inspectProcess,
    kill: (processId: number) => void = (processId) => {
      process.kill(-processId, 'SIGKILL');
    }
  ): void {
    let files: string[];
    try {
      files = readdirSync(this.directory);
    } catch {
      return;
    }
    for (const name of files) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      const file = path.join(this.directory, name);
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.size > 8192) continue;
        const entry = parseEnginePidRecord(JSON.parse(readFileSync(file, 'utf8')), this.engineBase);
        if (!entry || name !== `${entry.token}.json`) continue;
        const live = inspect(entry.pid);
        if (live && live.group === entry.pid && isRecordedEngineCommand(entry, live.command))
          kill(entry.pid);
      } catch {
        /* Corrupt/stale records and races must never prevent application startup. */
      } finally {
        try {
          rmSync(file, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
  }
}
