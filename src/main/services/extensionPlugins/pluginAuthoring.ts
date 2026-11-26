import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, type Stats } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  authoringCapabilities,
  preflightAuthoringManifest,
} from '@shared/extensionPlugins/authoringContract';
import type {
  PluginAuthoringCheck,
  PluginAuthoringContextResult,
  PluginAuthoringCreateResult,
  PluginAuthoringDraft,
  PluginAuthoringInspectResult,
  PluginAuthoringOptions,
  PluginAuthoringValidationResult,
} from '@shared/extensionPlugins/types';
import declarations from '../../../../examples/plugins/starter/enso-plugin.d.ts?raw';
import { packPlugin } from '../../../tooling/pluginPack';
import { samePluginFile } from './authoringFiles';
import { type AuthoringProject, AuthoringProjects, authoringSourceHash } from './authoringProjects';
import { buildAuthoringTemplate } from './authoringTemplates';
import { runAuthoringTests } from './authoringTestRunner';
import { MANIFEST_FILE, stagePlugin } from './install';
import type { ExtensionPluginService } from './service';

type Workspace = { cwd: string; projectId: string };
type BoundWorkspace = Workspace & { root: string; identity: Stats };
const unavailable = '本地 Code 会话的工作区不可用或已切换。';
const missing = '插件制作项目与当前会话/工作区不匹配，请从制作入口重新打开。';
type Service = Pick<
  ExtensionPluginService,
  'stage' | 'discard' | 'list' | 'installedPackage' | 'uninstall'
> &
  Partial<Pick<ExtensionPluginService, 'stageAuthoringSnapshot'>>;
const versionParts = (version: string) =>
  /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null;
const newer = (next: string, old: string) => {
  const a = versionParts(next),
    b = versionParts(old);
  return a && b && a.some((n, i) => n > b[i] && a.slice(0, i).every((p, j) => p === b[j]));
};

/** The registry remembers source ownership, never installation permissions or user data. */
export class PluginAuthoring {
  private readonly grants = new Map<string, symbol>();
  private readonly creating = new Set<string>();
  private readonly stores = new Map<string, AuthoringProjects>();
  private readonly editing = new Map<string, Promise<PluginAuthoringCreateResult>>();
  constructor(
    private readonly options: {
      workspace(sessionId: string): Workspace | null;
      hostVersion: string;
      stateRoot?: string;
    }
  ) {}
  private workspace(sessionId: string): BoundWorkspace {
    const value = this.options.workspace(sessionId);
    if (!value || !isAbsolute(value.cwd)) throw Error(unavailable);
    const root = realpathSync(value.cwd),
      identity = lstatSync(root);
    if (!identity.isDirectory()) throw Error(unavailable);
    return { ...value, root, identity };
  }
  private store(workspace: BoundWorkspace) {
    const root = this.options.stateRoot ?? join(workspace.root, '.codekiln-authoring');
    let store = this.stores.get(root);
    if (!store) {
      store = new AuthoringProjects(root);
      this.stores.set(root, store);
    }
    return store;
  }
  private belongs(
    row: Pick<AuthoringProject, 'projectId' | 'root' | 'rootDev' | 'rootIno'>,
    w: BoundWorkspace
  ) {
    return (
      row.projectId === w.projectId &&
      row.root === w.root &&
      row.rootDev === w.identity.dev &&
      row.rootIno === w.identity.ino
    );
  }
  private same(left: AuthoringProject, right: AuthoringProject) {
    return (
      left.projectId === right.projectId &&
      left.root === right.root &&
      left.draft.id === right.draft.id
    );
  }
  private directory(row: AuthoringProject) {
    const path = join(row.root, row.draft.directory),
      actual = lstatSync(path);
    if (
      !actual.isDirectory() ||
      actual.isSymbolicLink() ||
      actual.dev !== row.dev ||
      actual.ino !== row.ino ||
      realpathSync(path) !== path
    )
      throw Error('制作源码目录已被移动或替换，不会覆盖原文件');
    return path;
  }
  private grant(owner: number, session: string, id: string) {
    const token = Symbol();
    this.grants.set(`${owner}:${session}:${id}`, token);
    return token;
  }
  private async bound(owner: number, session: string, id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const w = this.workspace(session),
      store = this.store(w),
      key = `${owner}:${session}:${id}`,
      token = this.grants.get(key);
    if (!token) throw Error(missing);
    const row = (await store.read()).find((item) => item.draft.id === id && this.belongs(item, w));
    if (!row) throw Error(missing);
    const assertCurrent = () => {
      signal?.throwIfAborted();
      const current = this.workspace(session);
      if (
        this.grants.get(key) !== token ||
        !this.belongs(row, current) ||
        current.cwd !== w.cwd ||
        !samePluginFile(current.identity, w.identity)
      )
        throw Error(missing);
      return this.directory(row);
    };
    return { row, store, path: assertCurrent(), assertCurrent, w };
  }
  async context(_owner: number, session: string): Promise<PluginAuthoringContextResult> {
    const w = this.workspace(session);
    return {
      ok: true,
      capabilities: authoringCapabilities(this.options.hostVersion),
      drafts: (await this.store(w).read())
        .filter((row) => this.belongs(row, w))
        .map((row) => row.draft),
    };
  }
  async open(owner: number, session: string, id: string): Promise<PluginAuthoringCreateResult> {
    const w = this.workspace(session),
      row = (await this.store(w).read()).find(
        (item) => this.belongs(item, w) && item.draft.id === id
      );
    if (!row) throw Error(missing);
    this.directory(row);
    this.grant(owner, session, id);
    return { ok: true, draft: row.draft };
  }
  async create(
    owner: number,
    session: string,
    signal?: AbortSignal,
    options?: PluginAuthoringOptions
  ): Promise<PluginAuthoringCreateResult> {
    const key = `${owner}:${session}`;
    if (this.creating.has(key)) return { ok: false, error: '制作项目正在创建' };
    this.creating.add(key);
    try {
      const w = this.workspace(session),
        store = this.store(w);
      if (!options) {
        const existing = (await store.read()).find((row) => this.belongs(row, w));
        if (existing) return this.open(owner, session, existing.draft.id);
      }
      const slug = randomUUID().replaceAll('-', '').slice(0, 24),
        id = `local.draft${slug}`;
      const draft: PluginAuthoringDraft = {
        id,
        directory: `plugin-${slug}`,
        template: options?.template ?? 'workspace',
        request: options?.request ?? '',
        hostVersion: this.options.hostVersion,
        trialId: `local.try${slug}`,
      };
      const files = buildAuthoringTemplate({
        id,
        hostVersion: this.options.hostVersion,
        template: draft.template ?? 'workspace',
        request: draft.request,
      });
      const path = join(w.root, draft.directory);
      await mkdir(path, { mode: 0o700 });
      try {
        const info = lstatSync(path);
        for (const [name, text] of Object.entries({ ...files, 'enso-plugin.d.ts': declarations })) {
          signal?.throwIfAborted();
          if (
            !this.belongs(
              {
                projectId: w.projectId,
                root: w.root,
                rootDev: w.identity.dev,
                rootIno: w.identity.ino,
              },
              this.workspace(session)
            )
          )
            throw Error(unavailable);
          const target = join(path, name);
          await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
          await writeFile(target, text, { flag: 'wx', mode: 0o600 });
        }
        await store.change((rows) =>
          rows.push({
            projectId: w.projectId,
            root: w.root,
            rootDev: w.identity.dev,
            rootIno: w.identity.ino,
            dev: info.dev,
            ino: info.ino,
            draft,
            createdAt: Date.now(),
          })
        );
        this.grant(owner, session, id);
        return { ok: true, draft };
      } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
      }
    } finally {
      this.creating.delete(key);
    }
  }
  private async snapshot<T>(
    owner: number,
    session: string,
    id: string,
    signal: AbortSignal | undefined,
    run: (
      ctx: Awaited<ReturnType<PluginAuthoring['bound']>> & {
        snapshot: string;
        hash: string;
        manifest: import('@shared/extensionPlugins/manifest').ExtensionPluginManifest;
        warnings: string[];
      }
    ) => Promise<T>
  ): Promise<T> {
    const ctx = await this.bound(owner, session, id, signal);
    const temp = await mkdtemp(join(await realpath(tmpdir()), 'ck-authoring-'));
    try {
      const result = await stagePlugin(
        temp,
        { kind: 'dir', path: ctx.path },
        this.options.hostVersion,
        { signal }
      );
      if (!result.ok) throw Error(result.error);
      ctx.assertCurrent();
      if (result.staged.manifest.id !== id) throw Error('插件 ID 不得改变；它决定数据与授权的归属');
      const preflight = preflightAuthoringManifest(
        result.staged.manifest,
        authoringCapabilities(this.options.hostVersion)
      );
      if (preflight.errors.length) throw Error(preflight.errors.join('\n'));
      const hash = await authoringSourceHash(result.staged.pluginRoot);
      const value = await run({
        ...ctx,
        snapshot: result.staged.pluginRoot,
        hash,
        manifest: result.staged.manifest,
        warnings: [...result.staged.warnings, ...preflight.warnings],
      });
      ctx.assertCurrent();
      return value;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  async validate(
    owner: number,
    session: string,
    id: string,
    signal?: AbortSignal
  ): Promise<PluginAuthoringValidationResult> {
    try {
      return await this.snapshot(owner, session, id, signal, async ({ manifest, warnings }) => ({
        ok: true,
        name: manifest.name,
        version: manifest.version,
        warnings,
      }));
    } catch (error) {
      if (error instanceof Error && error.message === missing) throw error;
      return { ok: false, error: String(error instanceof Error ? error.message : error) };
    }
  }
  async inspect(
    owner: number,
    session: string,
    id: string,
    service?: Pick<Service, 'list'>,
    signal?: AbortSignal
  ): Promise<PluginAuthoringInspectResult> {
    try {
      return await this.snapshot(
        owner,
        session,
        id,
        signal,
        async ({ row, hash, manifest, warnings }) => {
          const unverified = (detail: string): PluginAuthoringCheck => ({
            state: 'unverified',
            detail,
          });
          const proof = (value: AuthoringProject['tests'], manual = false): PluginAuthoringCheck =>
            value
              ? {
                  state:
                    value.hash !== hash ? 'stale' : value.passed === false ? 'failed' : 'passed',
                  at: value.at,
                  detail: value.detail,
                  ...(manual ? { reportedBy: 'user' as const } : {}),
                }
              : unverified('尚未验证');
          const installed = service?.list().plugins.find((item) => item.id === id),
            trial = service?.list().plugins.find((item) => item.id === row.draft.trialId);
          const current = !!trial && row.trialHash === hash && row.trialBuild === trial.build;
          return {
            ok: true,
            draft: row.draft,
            name: manifest.name,
            version: manifest.version,
            sourceHash: hash,
            warnings,
            capabilities: authoringCapabilities(this.options.hostVersion),
            checks: {
              static: { state: 'passed', detail: '仅验证清单、能力和文件，未执行代码' },
              tests: proof(row.tests),
              runtime: trial
                ? {
                    state: !current
                      ? 'stale'
                      : trial.state === 'enabled' && trial.running
                        ? 'passed'
                        : trial.state === 'crashed'
                          ? 'failed'
                          : 'unverified',
                    detail: current
                      ? '试用副本已加载；不代表业务流程已验收'
                      : '源码与试用副本不同，请更新试用',
                  }
                : unverified('尚未启动试用副本'),
              business: proof(row.business, true),
              models: proof(row.models, true),
            },
            ...(installed
              ? {
                  installed: {
                    version: installed.version,
                    build: installed.build ?? '',
                    state: installed.state,
                  },
                }
              : {}),
            ...(trial
              ? { trial: { id: trial.id, version: trial.version, state: trial.state, current } }
              : {}),
            rollbackAvailable: !!row.rollback,
          };
        }
      );
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async evidence(
    owner: number,
    session: string,
    id: string,
    input: { layer: 'business' | 'models'; sourceHash: string; note: string; models?: string[] }
  ) {
    if (
      !['business', 'models'].includes(input.layer) ||
      !input.note?.trim() ||
      input.note.length > 2000
    )
      throw Error('请填写具体的验收结果');
    if (
      input.layer === 'models' &&
      (!input.models || new Set(input.models.map((item) => item.split('/')[0])).size < 2)
    )
      throw Error('需要两个不同厂商的实际模型验证记录');
    return this.snapshot(owner, session, id, undefined, async ({ row, store, hash }) => {
      if (hash !== input.sourceHash) throw Error('源码已改变，请重新验收');
      await store.change((rows) => {
        const target = rows.find((item) => this.same(item, row))!;
        target[input.layer] = {
          hash,
          at: Date.now(),
          detail: `${input.note}${input.models ? `\n模型：${input.models.join(', ')}` : ''}`,
        };
      });
      return { ok: true };
    });
  }
  async test(owner: number, session: string, id: string, confirmed: boolean, signal?: AbortSignal) {
    if (confirmed !== true) throw Error('运行测试将执行完整 Node 代码，必须明确同意');
    return this.snapshot(
      owner,
      session,
      id,
      signal,
      async ({ row, store, hash, snapshot, assertCurrent }) => {
        const result = await runAuthoringTests(snapshot, signal);
        assertCurrent();
        await store.change((rows) => {
          const target = rows.find((item) => this.same(item, row))!;
          target.tests = { hash, at: Date.now(), detail: result.output, passed: result.passed };
        });
        return { ok: true, ...result };
      }
    );
  }
  async export(owner: number, session: string, id: string, signal?: AbortSignal) {
    return this.snapshot(owner, session, id, signal, async ({ store, snapshot, manifest }) => {
      await store.prepare();
      const directory = join(store.root, `export-${randomUUID()}`);
      await mkdir(directory, { mode: 0o700 });
      const name = `${manifest.id}-${manifest.version.replace(/[^A-Za-z0-9.+_-]/g, '_')}.zip`;
      const packed = await packPlugin(snapshot, {
        hostVersion: this.options.hostVersion,
        out: join(directory, name),
      });
      return { ...packed, name, cleanup: () => rm(directory, { recursive: true, force: true }) };
    });
  }
  async stageTrial(
    owner: number,
    session: string,
    id: string,
    service: Service,
    signal?: AbortSignal
  ) {
    return this.snapshot(
      owner,
      session,
      id,
      signal,
      async ({ row, store, snapshot, manifest, hash, assertCurrent }) => {
        const trialId = row.draft.trialId;
        if (!trialId) throw Error('试用身份缺失，请重新打开制作项目');
        const raw = JSON.parse(await readFile(join(snapshot, MANIFEST_FILE), 'utf8'));
        raw.id = trialId;
        raw.name = `${manifest.name.slice(0, 50)}（试用）`;
        await writeFile(join(snapshot, MANIFEST_FILE), JSON.stringify(raw, null, 2));
        const packageHash = await authoringSourceHash(snapshot);
        const copy = join(store.root, `trial-${randomUUID()}`);
        await cp(snapshot, copy, { recursive: true, errorOnExist: true, force: false });
        const result = await service.stage({ kind: 'dir', path: copy }, owner, signal);
        try {
          assertCurrent();
          if (!result.ok) return result;
          if (result.preview.id !== trialId) throw Error('试用身份不匹配');
          await store.change((rows) => {
            const item = rows.find((item) => this.same(item, row))!;
            item.trialHash = hash;
            item.trialPackageHash = packageHash;
            delete item.trialBuild;
          });
          return result;
        } catch (error) {
          if (result.ok) service.discard(result.preview.token, owner);
          throw error;
        }
      }
    );
  }
  async trialLoaded(owner: number, session: string, id: string, service: Service) {
    const ctx = await this.bound(owner, session, id);
    const trial = service.list().plugins.find((item) => item.id === ctx.row.draft.trialId);
    if (trial?.state !== 'enabled') throw Error('请先确认安装并启用试用副本');
    const source = service.installedPackage(trial.id);
    if (
      !source ||
      !ctx.row.trialPackageHash ||
      (await authoringSourceHash(source.path)) !== ctx.row.trialPackageHash
    )
      throw Error('当前试用副本不是最近预览的源码，请确认安装最新试用');
    ctx.assertCurrent();
    await ctx.store.change((rows) => {
      const row = rows.find((item) => this.same(item, ctx.row))!;
      if (
        row.trialHash !== ctx.row.trialHash ||
        row.trialPackageHash !== ctx.row.trialPackageHash ||
        service.installedPackage(trial.id)?.build !== source.build
      )
        throw Error('试用确认期间源码或安装副本发生变化，请重新确认');
      row.trialBuild = trial.build;
    });
    return { ok: true, id: trial.id, views: trial.views, commands: trial.commands };
  }
  async finishTrial(owner: number, session: string, id: string, service: Service) {
    const { row } = await this.bound(owner, session, id);
    if (!row.draft.trialId) throw Error('试用身份缺失');
    return service.uninstall(row.draft.trialId);
  }
  async stage(owner: number, session: string, id: string, service: Service, signal?: AbortSignal) {
    return this.snapshot(
      owner,
      session,
      id,
      signal,
      async ({ row, store, path, snapshot, manifest, assertCurrent }) => {
        const installed = service.list?.().plugins.find((item) => item.id === id);
        if (installed && !newer(manifest.version, installed.version))
          throw Error(
            `更新必须递增版本：当前已安装 ${installed.version}，源码 ${manifest.version}`
          );
        const baseline = service.installedPackage?.(id);
        if (installed) {
          const source = baseline;
          if (source) {
            const name = `snapshot-${randomUUID()}`;
            await cp(source.path, join(store.root, name), {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
            assertCurrent();
            await store.change((rows) => {
              rows.find((item) => this.same(item, row))!.rollback = name;
            });
          }
        }
        const result = service.stageAuthoringSnapshot
          ? await service.stageAuthoringSnapshot(
              snapshot,
              path,
              owner,
              signal,
              false,
              baseline?.build ?? null
            )
          : await service.stage({ kind: 'dir', path: snapshot }, owner, signal);
        try {
          assertCurrent();
          if (result.ok && result.preview.id !== id) throw Error('正式安装身份不匹配');
          return result;
        } catch (error) {
          if (result.ok) service.discard(result.preview.token, owner);
          throw error;
        }
      }
    );
  }
  async rollback(owner: number, session: string, id: string, service: Service) {
    const { row, store, assertCurrent } = await this.bound(owner, session, id);
    if (!row.rollback) throw Error('没有升级前的代码快照');
    const path = join(store.root, row.rollback);
    const result = service.stageAuthoringSnapshot
      ? await service.stageAuthoringSnapshot(
          path,
          path,
          owner,
          undefined,
          true,
          service.installedPackage(id)?.build ?? null
        )
      : await service.stage({ kind: 'dir', path }, owner);
    try {
      assertCurrent();
      if (result.ok && result.preview.id !== id) throw Error('回退快照身份无效');
      return result;
    } catch (error) {
      if (result.ok) service.discard(result.preview.token, owner);
      throw error;
    }
  }
  async editInstalled(
    owner: number,
    session: string,
    id: string,
    service: Service
  ): Promise<PluginAuthoringCreateResult> {
    const w = this.workspace(session),
      key = `${w.projectId}:${w.root}:${id}`;
    const pending = this.editing.get(key);
    if (pending) {
      const result = await pending;
      if (
        !this.belongs(
          {
            projectId: w.projectId,
            root: w.root,
            rootDev: w.identity.dev,
            rootIno: w.identity.ino,
          },
          this.workspace(session)
        )
      )
        throw Error(unavailable);
      if (result.ok) this.grant(owner, session, id);
      return result;
    }
    const operation = this.copyInstalled(owner, session, id, service);
    this.editing.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.editing.get(key) === operation) this.editing.delete(key);
    }
  }
  private async copyInstalled(
    owner: number,
    session: string,
    id: string,
    service: Service
  ): Promise<PluginAuthoringCreateResult> {
    const w = this.workspace(session),
      store = this.store(w),
      existing = (await store.read()).find((row) => this.belongs(row, w) && row.draft.id === id);
    if (existing) return this.open(owner, session, id);
    const source = service.installedPackage(id);
    if (!source) throw Error('插件未安装，不能继续编辑');
    const slug = randomUUID().replaceAll('-', '').slice(0, 24),
      directory = `plugin-${slug}`,
      path = join(w.root, directory);
    await cp(source.path, path, { recursive: true, errorOnExist: true, force: false });
    const info = lstatSync(path),
      raw = JSON.parse(await readFile(join(path, MANIFEST_FILE), 'utf8'));
    const parts = versionParts(raw.version);
    if (parts) raw.version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    await writeFile(join(path, MANIFEST_FILE), JSON.stringify(raw, null, 2));
    await writeFile(
      join(path, 'HOST-CAPABILITIES.md'),
      `制作宿主：${this.options.hostVersion}\n\n${authoringCapabilities(this.options.hostVersion).guide}`,
      { mode: 0o600 }
    );
    if (!existsSync(join(path, 'enso-plugin.d.ts')))
      await writeFile(join(path, 'enso-plugin.d.ts'), declarations, { flag: 'wx', mode: 0o600 });
    const draft: PluginAuthoringDraft = {
      id,
      directory,
      hostVersion: this.options.hostVersion,
      trialId: `local.try${slug}`,
      baseVersion: source.version,
      request: '继续修改已安装的插件；保持原插件 ID、数据和配置',
    };
    await store.change((rows) =>
      rows.push({
        projectId: w.projectId,
        root: w.root,
        rootDev: w.identity.dev,
        rootIno: w.identity.ino,
        dev: info.dev,
        ino: info.ino,
        draft,
        createdAt: Date.now(),
      })
    );
    this.grant(owner, session, id);
    return { ok: true, draft };
  }
  releaseOwner(owner: number) {
    for (const key of this.grants.keys()) if (key.startsWith(`${owner}:`)) this.grants.delete(key);
  }
}
