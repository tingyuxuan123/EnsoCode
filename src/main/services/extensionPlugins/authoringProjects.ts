import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { PluginAuthoringDraft } from '@shared/extensionPlugins/types';

export interface AuthoringEvidence {
  hash: string;
  at: number;
  detail: string;
  passed?: boolean;
}
export interface AuthoringProject {
  projectId: string;
  root: string;
  rootDev: number;
  rootIno: number;
  dev: number;
  ino: number;
  draft: PluginAuthoringDraft;
  createdAt: number;
  tests?: AuthoringEvidence;
  business?: AuthoringEvidence;
  models?: AuthoringEvidence;
  trialHash?: string;
  trialBuild?: string;
  trialPackageHash?: string;
  rollback?: string;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const safeId = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(v);
export class AuthoringProjects {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  async prepare() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(this.root)) !== this.root)
      throw Error('制作项目数据目录不允许链接');
  }
  async read(): Promise<AuthoringProject[]> {
    await this.queue;
    return this.load();
  }
  private async load(): Promise<AuthoringProject[]> {
    await this.prepare();
    const path = join(this.root, 'projects.json');
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024)
        throw Error('制作项目登记文件无效');
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const actual = await file.stat();
      if (actual.ino !== info.ino || actual.dev !== info.dev || actual.size !== info.size)
        throw Error('制作项目登记文件已变化');
      const raw: unknown = JSON.parse(await file.readFile('utf8'));
      if (
        !object(raw) ||
        raw.version !== 1 ||
        !Array.isArray(raw.projects) ||
        raw.projects.length > 128
      )
        throw Error('制作项目登记文件结构无效');
      const projects: AuthoringProject[] = [];
      const keys = new Set<string>();
      for (const item of raw.projects) {
        if (
          !object(item) ||
          !object(item.draft) ||
          !safeId(item.draft.id) ||
          typeof item.draft.directory !== 'string' ||
          !/^plugin-[a-f0-9]{24}$/.test(item.draft.directory) ||
          typeof item.root !== 'string' ||
          !isAbsolute(item.root) ||
          typeof item.projectId !== 'string' ||
          ['rootDev', 'rootIno', 'dev', 'ino', 'createdAt'].some(
            (key) => !Number.isFinite(item[key])
          ) ||
          (item.rollback !== undefined &&
            (typeof item.rollback !== 'string' || !/^snapshot-[a-f0-9-]{36}$/.test(item.rollback)))
        )
          throw Error('制作项目记录无效，原文件未改动');
        if (
          item.draft.request !== undefined &&
          (typeof item.draft.request !== 'string' || item.draft.request.length > 4000)
        )
          throw Error('制作需求无效');
        if (
          item.draft.trialId !== `local.try${item.draft.directory.slice('plugin-'.length)}` ||
          item.draft.trialId === item.draft.id
        )
          throw Error('试用身份无效，不能操作正式插件');
        for (const name of ['tests', 'business', 'models']) {
          const proof = item[name];
          if (
            proof !== undefined &&
            (!object(proof) ||
              typeof proof.hash !== 'string' ||
              !/^[a-f0-9]{64}$/.test(proof.hash) ||
              typeof proof.detail !== 'string' ||
              proof.detail.length > 16000 ||
              !Number.isFinite(proof.at))
          )
            throw Error('制作验收记录无效');
          if (
            name === 'tests' &&
            proof !== undefined &&
            object(proof) &&
            typeof proof.passed !== 'boolean'
          )
            throw Error('自动化测试证据缺少明确的布尔结果，不能恢复为通过');
        }
        const key = `${item.projectId}:${item.root}:${item.draft.id}`;
        if (keys.has(key)) throw Error('制作项目登记文件含重复身份');
        keys.add(key);
        projects.push(item as unknown as AuthoringProject);
      }
      return projects;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    } finally {
      await file?.close();
    }
  }
  async change<T>(change: (items: AuthoringProject[]) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const items = await this.load();
      const result = await change(items);
      if (items.length > 128) throw Error('制作项目上限128个，请先备份和整理');
      const temp = join(this.root, `.projects-${randomUUID()}.tmp`);
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, projects: items }, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await rename(temp, join(this.root, 'projects.json'));
      } finally {
        await rm(temp, { force: true });
      }
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

/** Called only on installation-validated private snapshots, not user-controlled links. */
export async function authoringSourceHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.name === '.DS_Store' || entry.name === '.git') continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        hash.update(relative(root, file));
        hash.update('\0');
        hash.update(await readFile(file));
        hash.update('\0');
      }
    }
  };
  await walk(root);
  return hash.digest('hex');
}
