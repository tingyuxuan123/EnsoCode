import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { grantExpands, grantOf } from '@shared/extensionPlugins/grant';
import {
  type ExtensionPluginManifest,
  isPluginRelativePath,
  type PluginPresetContrib,
  parseExtensionPluginManifest,
} from '@shared/extensionPlugins/manifest';
import { parsePluginPresetId, pluginPresetId } from '@shared/extensionPlugins/preset';
import type { PluginCallMethod, PluginToolResult } from '@shared/extensionPlugins/protocol';
import { parsePluginToolName, pluginToolName } from '@shared/extensionPlugins/toolName';
import type {
  ExtensionPluginConfigField,
  ExtensionPluginInstallPreview,
  ExtensionPluginListResult,
  ExtensionPluginSummary,
  PluginToolDescriptor,
} from '@shared/extensionPlugins/types';
import type { McpServerSpawnConfig } from '@shared/types/agent';
import { type GateDeps, PluginHostGate } from './gate';
import {
  commitStaged,
  discardStaged,
  MANIFEST_FILE,
  type PluginInstallSource,
  pluginDataPath,
  pluginPackagePath,
  removePackage,
  type StagedPlugin,
  stagePlugin,
} from './install';
import {
  applyPluginAction,
  type PluginAction,
  type PluginRecord,
  recordPluginCrash,
} from './lifecycle';
import { PluginProcess, type PluginProcessDeps, pluginError } from './process';
import { readRegistry, writeRegistry } from './registry';

// biome-ignore lint/suspicious/noTemplateCurlyInString: Manifest literal placeholder.
const ROOT_TOKEN = '${ENSO_PLUGIN_ROOT}';
const STAGE_TTL = 600_000;
const within = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
export interface ExtensionPluginServiceOptions {
  root: string;
  hostVersion: string;
  hostPath: string;
  env: NodeJS.ProcessEnv;
  fork: PluginProcessDeps['fork'];
  gate: Omit<GateDeps, 'manifest' | 'config'>;
}
export type UiCallMethod = Exclude<PluginCallMethod, 'tool.execute'>;
export function uiCallTimeout(
  manifest: { contributes: Pick<ExtensionPluginManifest['contributes'], 'methods'> },
  method: UiCallMethod,
  payload: Record<string, unknown>
): number {
  if (method === 'command.run') return 60_000;
  return method === 'renderer.call'
    ? (manifest.contributes.methods.find((m) => m.name === payload.method)?.timeoutMs ?? 2000)
    : 2000;
}
export type PluginPresetSpawn =
  | {
      ok: true;
      instruction?: { path: string; content: string };
      systemPrompt?: string;
    }
  | { ok: false; error: string };

export class ExtensionPluginService {
  readonly gate: PluginHostGate;
  private records: PluginRecord[];
  private readonly loaded = new Map<string, ExtensionPluginManifest>();
  private readonly processes = new Map<string, PluginProcess>();
  private readonly staged = new Map<string, { staged: StagedPlugin; at: number; owner: number }>();
  private readonly crashes = new Map<string, number[]>();
  private readonly uiCalls = new Map<
    string,
    { stamps: number[]; failures: number; openUntil: number }
  >();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly registryError: string | undefined;
  constructor(private readonly options: ExtensionPluginServiceOptions) {
    const registry = readRegistry(options.root);
    this.records = registry.plugins;
    this.registryError = registry.error;
    // Tokens are memory-only. A restarted application can never commit abandoned staging data.
    rmSync(join(options.root, 'staging'), { recursive: true, force: true });
    this.gate = new PluginHostGate({
      ...options.gate,
      manifest: (id) => this.enabledManifest(id),
      config: (id) => this.configValues(id),
    });
  }
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  list(): ExtensionPluginListResult {
    const plugins: ExtensionPluginSummary[] = this.records.flatMap((r) => {
      const m = this.load(r.id, r.dir);
      if (!m) return [];
      const pending = r.pending ? this.load(r.id, r.pending.dir) : null;
      return [
        {
          id: r.id,
          name: m.name,
          version: r.version,
          description: m.description,
          state: r.state,
          permissions: m.permissions,
          tools: m.contributes.agentTools.map(({ name, description }) => ({ name, description })),
          commands: m.contributes.commands,
          views: m.contributes.views,
          triggers: m.contributes.triggers,
          hasRenderer: !!m.renderer,
          ...(m.renderer ? { renderer: m.renderer } : {}),
          configurable: m.contributes.configuration.length > 0,
          presets: m.contributes.presets.map((p) => ({
            id: pluginPresetId(r.id, p.id),
            name: p.name,
            skills: p.skills.length,
            mcpServers: p.mcpServers.length,
            instruction: !!p.instruction,
          })),
          ...(r.pending && pending
            ? { pendingVersion: r.pending.version, pendingPermissions: pending.permissions }
            : {}),
        },
      ];
    });
    return { plugins, ...(this.registryError ? { registryError: this.registryError } : {}) };
  }
  enabledManifest(id: string): ExtensionPluginManifest | null {
    if (this.disposed) return null;
    const r = this.records.find((r) => r.id === id);
    return r?.state === 'enabled' ? this.load(id, r.dir) : null;
  }
  async stage(source: PluginInstallSource, owner: number, signal?: AbortSignal) {
    if (this.registryError) return { ok: false as const, error: this.registryError };
    if (this.disposed || !Number.isSafeInteger(owner))
      return { ok: false as const, error: '窗口不可用' };
    this.sweepStaged();
    const result = await stagePlugin(this.options.root, source, this.options.hostVersion, {
      signal,
    });
    if (!result.ok) return result;
    if (this.disposed || signal?.aborted) {
      discardStaged(this.options.root, result.staged);
      return { ok: false as const, error: '应用已关闭' };
    }
    const { staged } = result;
    this.staged.set(staged.token, { staged, at: Date.now(), owner });
    const m = staged.manifest;
    const grant = grantOf(m);
    const existing = this.records.find((r) => r.id === m.id);
    const preview: ExtensionPluginInstallPreview = {
      token: staged.token,
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      permissions: m.permissions,
      fsRead: m.fs.read,
      fsWrite: m.fs.write,
      netDomains: m.net.domains,
      mcpServers: grant.mcp,
      mcpTools: m.mcp.tools,
      tools: m.contributes.agentTools.map(({ name, description }) => ({ name, description })),
      hasRenderer: !!m.renderer,
      warnings: staged.warnings,
      ...(existing ? { existingVersion: existing.version } : {}),
      expands: existing ? grantExpands(existing.grant, grant) : true,
    };
    return { ok: true as const, preview };
  }
  discard(token: string, owner: number): boolean {
    const entry = this.staged.get(token);
    if (!entry || entry.owner !== owner) return false;
    this.staged.delete(token);
    discardStaged(this.options.root, entry.staged);
    return true;
  }
  releaseOwner(owner: number): void {
    for (const [token, e] of this.staged) if (e.owner === owner) this.discard(token, owner);
  }
  /** Commit never executes plugin code. Disabled/new/pending plugins remain entirely inert. */
  async commit(token: string, owner: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.registryError) return { ok: false, error: this.registryError };
    this.sweepStaged();
    const entry = this.staged.get(token);
    if (!entry || entry.owner !== owner) return { ok: false, error: '安装已过期或不属于此窗口' };
    this.staged.delete(token);
    const { manifest: m } = entry.staged;
    let dir: string;
    try {
      dir = commitStaged(this.options.root, entry.staged);
    } catch (e) {
      discardStaged(this.options.root, entry.staged);
      return { ok: false, error: e instanceof Error ? e.message : '安装失败' };
    }
    const grant = grantOf(m);
    const existing = this.records.find((r) => r.id === m.id);
    if (!existing)
      this.records.push({
        id: m.id,
        version: m.version,
        dir,
        state: 'disabled',
        grant,
        installedAt: Date.now(),
      });
    else {
      const oldDir = existing.dir;
      const stale = existing.pending?.dir;
      const expands = grantExpands(existing.grant, grant);
      this.apply(m.id, { type: 'update', version: m.version, dir, grant, expands });
      if (stale) removePackage(this.options.root, m.id, stale);
      if (!expands) {
        this.stopProcess(m.id);
        removePackage(this.options.root, m.id, oldDir);
      }
    }
    this.persist();
    return { ok: true };
  }
  setEnabled(id: string, enabled: boolean) {
    if (this.registryError) return { ok: false, error: this.registryError };
    if (!enabled) this.stopProcess(id);
    else this.crashes.delete(id);
    return this.applyAndPersist(id, { type: enabled ? 'enable' : 'disable' });
  }
  approvePending(id: string) {
    const old = this.records.find((r) => r.id === id)?.dir;
    const result = this.applyAndPersist(id, { type: 'approve-pending' });
    if (result.ok && old) {
      this.stopProcess(id);
      removePackage(this.options.root, id, old);
    }
    return result;
  }
  rejectPending(id: string) {
    const pending = this.records.find((r) => r.id === id)?.pending?.dir;
    const result = this.applyAndPersist(id, { type: 'reject-pending' });
    if (result.ok && pending) removePackage(this.options.root, id, pending);
    return result;
  }
  async uninstall(id: string): Promise<{ ok: boolean; error?: string }> {
    if (this.registryError) return { ok: false, error: this.registryError };
    if (!this.records.some((r) => r.id === id)) return { ok: false, error: '插件未安装' };
    this.records = this.records.filter((r) => r.id !== id);
    this.stopProcess(id);
    this.persist();
    rmSync(join(this.options.root, 'packages', id), { recursive: true, force: true });
    rmSync(pluginDataPath(this.options.root, id), { recursive: true, force: true });
    rmSync(this.configPath(id), { force: true });
    this.crashes.delete(id);
    this.uiCalls.delete(id);
    for (const key of this.loaded.keys()) if (key.startsWith(`${id}/`)) this.loaded.delete(key);
    for (const [token, e] of this.staged)
      if (e.staged.manifest.id === id) this.discard(token, e.owner);
    return { ok: true };
  }
  configValues(id: string): Record<string, string> {
    const m = this.installedManifest(id);
    if (!m) return {};
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.configPath(id), 'utf8'));
    } catch {
      return {};
    }
    const out = Object.create(null) as Record<string, string>;
    if (!raw || typeof raw !== 'object') return out;
    for (const f of m.contributes.configuration) {
      const v = (raw as Record<string, unknown>)[f.key];
      if (typeof v === 'string') out[f.key] = v;
    }
    return out;
  }
  configView(
    id: string
  ): { ok: true; fields: ExtensionPluginConfigField[] } | { ok: false; error: string } {
    const m = this.installedManifest(id);
    if (!m) return { ok: false, error: '插件未安装' };
    const values = this.configValues(id);
    return {
      ok: true,
      fields: m.contributes.configuration.map((f) => ({
        ...f,
        set: values[f.key] !== undefined,
        ...(!f.secret && values[f.key] !== undefined ? { value: values[f.key] } : {}),
      })),
    };
  }
  setConfig(id: string, patch: Record<string, string | null>): { ok: boolean; error?: string } {
    if (this.registryError) return { ok: false, error: this.registryError };
    const m = this.installedManifest(id);
    if (!m) return { ok: false, error: '插件未安装' };
    const keys = new Set(m.contributes.configuration.map((f) => f.key));
    const next = this.configValues(id);
    for (const [k, v] of Object.entries(patch)) {
      if (!keys.has(k) || (v !== null && (typeof v !== 'string' || v.length > 4096)))
        return { ok: false, error: '配置项不合法或过长' };
      if (v === null) delete next[k];
      else next[k] = v;
    }
    const target = this.configPath(id);
    mkdirSync(join(this.options.root, 'config'), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, target);
    this.changed();
    return { ok: true };
  }
  toolsForSpawn(): PluginToolDescriptor[] {
    return this.enabled().flatMap(({ id, dir, manifest: m }) =>
      m.contributes.agentTools.map((t) => ({
        ...t,
        name: pluginToolName(id, t.name),
        pluginId: id,
        fingerprint: this.fingerprint(dir, m),
      }))
    );
  }
  skillPathsForSpawn(presetId?: string): string[] {
    return this.enabled().flatMap(({ id, dir, manifest: m }) => {
      const root = pluginPackagePath(this.options.root, id, dir);
      const selection = this.selection(m, id, presetId, (p) => p.skills);
      return m.contributes.skills
        .filter((s) => !selection.scoped.has(s) || selection.selected.has(s))
        .map((s) => resolve(root, s));
    });
  }
  mcpServersForSpawn(presetId?: string): McpServerSpawnConfig[] {
    return this.enabled().flatMap(({ id, dir, manifest: m }) => {
      const root = pluginPackagePath(this.options.root, id, dir);
      const expand = (v: string) => v.replaceAll(ROOT_TOKEN, root);
      const selection = this.selection(m, id, presetId, (p) => p.mcpServers);
      return m.contributes.mcpServers
        .filter((s) => !selection.scoped.has(s.name) || selection.selected.has(s.name))
        .map((s) => ({
          name: `plugin-${id.replaceAll('.', '-')}-${s.name}`,
          description: `${m.name} 插件`,
          transport: 'stdio' as const,
          command: expand(s.command),
          args: s.args.map(expand),
          env: {
            ...Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, expand(v)])),
            ENSO_PLUGIN_ROOT: root,
          },
        }));
    });
  }
  sessionResources(presetId?: string) {
    return {
      tools: this.toolsForSpawn(),
      skillPaths: this.skillPathsForSpawn(presetId),
      mcpServers: this.mcpServersForSpawn(presetId),
      preset: this.presetForSpawn(presetId),
    };
  }
  presetForSpawn(presetId?: string): PluginPresetSpawn | undefined {
    if (!presetId) return undefined;
    const parsed = parsePluginPresetId(presetId);
    if (!parsed)
      return presetId.startsWith('plugin:') ? { ok: false, error: '插件预设不合法' } : undefined;
    const loaded = this.enabled().find((e) => e.id === parsed.pluginId);
    const p = loaded?.manifest.contributes.presets.find((p) => p.id === parsed.localId);
    if (!loaded || !p) return { ok: false, error: '插件预设不可用，请重新选择或恢复默认。' };
    const root = pluginPackagePath(this.options.root, loaded.id, loaded.dir);
    const result: Extract<PluginPresetSpawn, { ok: true }> = { ok: true };
    const fields = [
      ['instruction', 'instruction'],
      ['systemPrompt', 'systemPrompt'],
    ] as const;
    for (const [key, target] of fields) {
      const rel = p[key];
      if (!rel) continue;
      const content = readPluginText(root, rel);
      if (content === null) return { ok: false, error: '插件预设正文读取失败，请重新安装。' };
      if (target === 'instruction') result.instruction = { path: join(root, rel), content };
      else result[target] = content;
    }
    return result;
  }
  async callTool(input: {
    toolName: string;
    fingerprint: string;
    args: unknown;
    sessionId: string;
    projectRoot: string | null;
    signal?: AbortSignal;
  }): Promise<PluginToolResult> {
    const parsed = parsePluginToolName(input.toolName);
    if (!parsed) throw pluginError('NOT_FOUND', '不是插件工具');
    const m = this.enabledManifest(parsed.pluginId);
    if (!m) throw pluginError('PLUGIN_DISABLED', '插件未启用');
    const r = this.records.find((r) => r.id === parsed.pluginId)!;
    if (!input.fingerprint || input.fingerprint !== this.fingerprint(r.dir, m))
      throw pluginError('STALE_PLUGIN', '插件已更新，请重新加载会话工具');
    if (!m.contributes.agentTools.some((t) => t.name === parsed.toolName))
      throw pluginError('NOT_DECLARED', '插件未声明工具');
    const value = await this.invoke(
      parsed.pluginId,
      'tool.execute',
      { name: parsed.toolName, args: input.args },
      {
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        gesture: false,
        timeoutMs: 60_000,
      },
      input.signal
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('content' in value) ||
      typeof value.content !== 'string'
    )
      throw pluginError('BAD_RESULT', '插件工具返回值不合法');
    if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
      throw pluginError('TOO_LARGE', '插件工具结果超过 1MB');
    return value as PluginToolResult;
  }
  async callUi(input: {
    pluginId: string;
    method: UiCallMethod;
    payload: Record<string, unknown>;
    sessionId: string | null;
    projectRoot: string | null;
    origin?: number | null;
    gesture?: boolean;
  }): Promise<unknown> {
    const m = this.enabledManifest(input.pluginId);
    if (!m) throw pluginError('PLUGIN_DISABLED', '插件未启用');
    const declared =
      input.method === 'command.run'
        ? m.contributes.commands.some((c) => c.id === input.payload.id)
        : input.method === 'renderer.call'
          ? m.permissions.includes('ui.slot') || m.permissions.includes('ui.view')
          : m.contributes.triggers.some((t) => t.name === input.payload.name);
    if (!declared) throw pluginError('NOT_DECLARED', '清单未声明能力');
    if (Buffer.byteLength(JSON.stringify(input.payload)) > 65536)
      throw pluginError('TOO_LARGE', '参数超过 64KB');
    this.admitUiCall(input.pluginId);
    // Typing # and fetching candidates is NOT a gesture authorizing composer mutation.
    const gesture = input.gesture === true && input.method !== 'trigger.candidates';
    try {
      const value = await this.invoke(input.pluginId, input.method, input.payload, {
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        gesture,
        origin: input.origin ?? null,
        timeoutMs: uiCallTimeout(m, input.method, input.payload),
      });
      if (Buffer.byteLength(JSON.stringify(value ?? null)) > 65536)
        throw pluginError('TOO_LARGE', '返回值超过 64KB');
      this.settleUiCall(input.pluginId, true);
      return value;
    } catch (e) {
      this.settleUiCall(input.pluginId, false);
      throw e;
    }
  }
  assetPath(pluginId: string, rel: string): string | null {
    const r = this.records.find((r) => r.id === pluginId);
    const m = this.enabledManifest(pluginId);
    if (
      !r ||
      !m ||
      !isPluginRelativePath(rel) ||
      !(rel === m.renderer || m.contributes.views.some((v) => v.entry === rel))
    )
      return null;
    const root = pluginPackagePath(this.options.root, r.id, r.dir);
    try {
      const path = realpathSync(resolve(root, rel));
      return within(realpathSync(root), path) && statSync(path).isFile() ? path : null;
    } catch {
      return null;
    }
  }
  recordCrash(id: string): void {
    const crash = recordPluginCrash(this.crashes.get(id) ?? [], Date.now());
    this.crashes.set(id, crash.timestamps);
    if (crash.blocked) {
      this.crashes.delete(id);
      this.stopProcess(id);
      this.applyAndPersist(id, { type: 'crash' });
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.processes.keys()]) this.stopProcess(id);
    for (const [token, e] of this.staged) this.discard(token, e.owner);
    this.gate.dispose();
    this.listeners.clear();
    this.loaded.clear();
    this.uiCalls.clear();
    this.crashes.clear();
  }
  private async invoke(
    pluginId: string,
    method: PluginCallMethod,
    payload: unknown,
    ctx: {
      sessionId: string | null;
      projectRoot: string | null;
      gesture: boolean;
      origin?: number | null;
      timeoutMs: number;
    },
    signal?: AbortSignal
  ): Promise<unknown> {
    if (signal?.aborted) throw pluginError('ABORTED', '调用已取消');
    const proc = this.processFor(pluginId);
    const invocationId = this.gate.invocations.create({
      pluginId,
      sessionId: ctx.sessionId,
      projectRoot: ctx.projectRoot,
      gesture: ctx.gesture,
      origin: ctx.origin ?? null,
    });
    const onAbort = () => {
      this.gate.invocations.cancel(invocationId);
      proc.cancel(invocationId);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await proc.call(method, payload, {
        invocationId,
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        timeoutMs: ctx.timeoutMs,
      });
    } catch (e) {
      this.gate.invocations.cancel(invocationId);
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.gate.invocations.finish(invocationId);
    }
  }
  private processFor(id: string): PluginProcess {
    const existing = this.processes.get(id);
    if (existing) return existing;
    const r = this.records.find((r) => r.id === id);
    const m = r ? this.load(id, r.dir) : null;
    if (!r || !m?.main) throw pluginError('NOT_FOUND', '插件没有 main');
    const dataDir = pluginDataPath(this.options.root, id);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const proc = new PluginProcess({
      fork: this.options.fork,
      hostPath: this.options.hostPath,
      env: { ...this.options.env, ENSO_PLUGIN_DATA: dataDir },
      init: {
        pluginId: id,
        pluginRoot: pluginPackagePath(this.options.root, id, r.dir),
        main: m.main,
        dataDir,
      },
      handleHostCall: (api, args, invocationId) => this.gate.handle(id, api, args, invocationId),
      onExit: ({ unexpected }) => {
        this.gate.invocations.cancelPlugin(id);
        if (unexpected) this.recordCrash(id);
      },
    });
    this.processes.set(id, proc);
    return proc;
  }
  private stopProcess(id: string): void {
    this.gate.invocations.cancelPlugin(id);
    this.processes.get(id)?.stop();
    this.processes.delete(id);
  }
  private enabled() {
    return this.records.flatMap((r) => {
      const manifest = this.enabledManifest(r.id);
      return manifest ? [{ id: r.id, dir: r.dir, manifest }] : [];
    });
  }
  private installedManifest(id: string) {
    const r = this.records.find((r) => r.id === id);
    return r ? this.load(id, r.dir) : null;
  }
  private configPath(id: string) {
    return join(this.options.root, 'config', `${id}.json`);
  }
  private fingerprint(dir: string, m: ExtensionPluginManifest): string {
    return createHash('sha256')
      .update(JSON.stringify([dir, m.version, grantOf(m), m]))
      .digest('hex');
  }
  private load(id: string, dir: string): ExtensionPluginManifest | null {
    const key = `${id}/${dir}`;
    const cached = this.loaded.get(key);
    if (cached) return cached;
    try {
      const path = join(pluginPackagePath(this.options.root, id, dir), MANIFEST_FILE);
      if (statSync(path).size > 256 * 1024) return null;
      const parsed = parseExtensionPluginManifest(
        JSON.parse(readFileSync(path, 'utf8')),
        this.options.hostVersion
      );
      if (!parsed.ok || parsed.manifest.id !== id) return null;
      this.loaded.set(key, parsed.manifest);
      return parsed.manifest;
    } catch {
      return null;
    }
  }
  private apply(id: string, action: PluginAction): { ok: boolean; error?: string } {
    const index = this.records.findIndex((r) => r.id === id);
    const r = this.records[index];
    if (!r) return { ok: false, error: '插件未安装' };
    const next = applyPluginAction(r, action);
    if ('error' in next) return { ok: false, error: next.error };
    this.records[index] = next;
    return { ok: true };
  }
  private applyAndPersist(id: string, action: PluginAction) {
    if (this.registryError) return { ok: false, error: this.registryError };
    const result = this.apply(id, action);
    if (result.ok) this.persist();
    return result;
  }
  private persist(): void {
    if (this.registryError) throw new Error(this.registryError);
    writeRegistry(this.options.root, { version: 1, plugins: this.records });
    this.changed();
  }
  private changed(): void {
    for (const listener of this.listeners) listener();
  }
  private sweepStaged(): void {
    for (const [token, e] of this.staged)
      if (Date.now() - e.at > STAGE_TTL) this.discard(token, e.owner);
  }
  private selection(
    m: ExtensionPluginManifest,
    id: string,
    presetId: string | undefined,
    pick: (p: PluginPresetContrib) => readonly string[]
  ) {
    const parsed = presetId ? parsePluginPresetId(presetId) : undefined;
    const active =
      parsed?.pluginId === id
        ? m.contributes.presets.find((p) => p.id === parsed.localId)
        : undefined;
    return {
      scoped: new Set(m.contributes.presets.flatMap((p) => [...pick(p)])),
      selected: new Set(active ? pick(active) : []),
    };
  }
  private admitUiCall(id: string): void {
    const now = Date.now();
    const state = this.uiCalls.get(id) ?? { stamps: [], failures: 0, openUntil: 0 };
    this.uiCalls.set(id, state);
    if (now < state.openUntil) throw pluginError('CIRCUIT_OPEN', '插件连续失败，稍后再试');
    state.stamps = state.stamps.filter((t) => now - t < 1000);
    if (state.stamps.length >= 10) throw pluginError('RATE_LIMITED', '调用过于频繁');
    state.stamps.push(now);
  }
  private settleUiCall(id: string, ok: boolean): void {
    const state = this.uiCalls.get(id);
    if (!state) return;
    if (ok) state.failures = 0;
    else if (++state.failures >= 5) {
      state.failures = 0;
      state.openUntil = Date.now() + 30_000;
    }
  }
}
function readPluginText(root: string, rel: string): string | null {
  if (!isPluginRelativePath(rel) || rel === '.') return null;
  try {
    const path = realpathSync(resolve(root, rel));
    if (!within(realpathSync(root), path)) return null;
    const info = statSync(path);
    if (!info.isFile() || info.size > 256 * 1024) return null;
    const content = readFileSync(path, 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}
