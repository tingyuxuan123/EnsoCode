import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  applyInterceptResult,
  BEFORE_COMPACT_TIMEOUT_MS,
  CHILD_INTERCEPT_TIMEOUT_MS,
  CHILD_INTERCEPT_TOTAL_TIMEOUT_MS,
  failClosedResult,
  INTERCEPT_TIMEOUT_MS,
  INTERCEPT_TOTAL_TIMEOUT_MS,
  type InterceptPayload,
  type InterceptResult,
  initialInterceptState,
  isChildInterceptEvent,
  isHostPluginEvent,
  OBSERVE_TIMEOUT_MS,
  type PluginEventName,
  type PluginInterceptEvent,
} from '@shared/extensionPlugins/events';
import { grantExpands, grantOf } from '@shared/extensionPlugins/grant';
import { pluginManifestProbeUrl } from '@shared/extensionPlugins/installUrl';
import {
  type ExtensionPluginManifest,
  isNewerPluginVersion,
  isPluginRelativePath,
  type PluginConfigContrib,
  type PluginPresetContrib,
  parseExtensionPluginManifest,
} from '@shared/extensionPlugins/manifest';
import { parsePluginPresetId, pluginPresetId } from '@shared/extensionPlugins/preset';
import {
  PLUGIN_PROGRESS_MAX_CHARS,
  type PluginAgentSource,
  type PluginArtifactInfo,
  type PluginCallMethod,
  type PluginHostCapabilities,
  type PluginInjectImage,
  type PluginToolResult,
} from '@shared/extensionPlugins/protocol';
import { mergeStatusItems, type StatusPatch } from '@shared/extensionPlugins/statusItems';
import { parsePluginToolName, pluginToolName } from '@shared/extensionPlugins/toolName';
import type {
  ExtensionPluginCommitResult,
  ExtensionPluginConfigField,
  ExtensionPluginInstallPreview,
  ExtensionPluginListResult,
  ExtensionPluginMarketList,
  ExtensionPluginNotice,
  ExtensionPluginSummary,
  PluginEventPlan,
  PluginToolDescriptor,
  RegistryNotice,
} from '@shared/extensionPlugins/types';
import type { McpServerSpawnConfig } from '@shared/types/agent';
import type {
  NativeAgentTypeSource,
  NativePluginAgentDef,
  PluginAgentTypeDrop,
} from '../pluginRuntime';
import { ArtifactStore } from './artifacts';
import { downloadPluginArchive } from './download';
import { DynamicContribs } from './dynamic';
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
import { DEFAULT_LOG_TAIL_BYTES, PluginLogger } from './log';
import { marketIconUrl, type PluginMarket } from './market';
import { type PluginLogLevel, PluginProcess, type PluginProcessDeps, pluginError } from './process';
import { type ReadmeResult, readPackageReadme } from './readme';
import { readRegistry, writeRegistry } from './registry';
import { ViewStateStore } from './viewState';

// biome-ignore lint/suspicious/noTemplateCurlyInString: Manifest literal placeholder.
const ROOT_TOKEN = '${ENSO_PLUGIN_ROOT}';
const STAGE_TTL = 600_000;
/** Internal installs cannot reuse a renderer's owner-bound token. */
const INTERNAL_OWNER = -1;
const DEV_IGNORED = /(^|[\\/])(\.[^\\/]*|node_modules)([\\/]|$)|\.zip$/;
/** 单个配置值的字符上限；超过按不合法处理，避免把大段文本写进本地配置 */
const MAX_CONFIG_VALUE_CHARS = 64 * 1024;
export type ConfigValue = string | number | boolean;
function configMatches(field: PluginConfigContrib, value: ConfigValue): boolean {
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}
function coerceConfig(
  field: PluginConfigContrib,
  value: ConfigValue
): ConfigValue | { error: string } {
  if (field.type === 'number') {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
          ? Number(value.trim())
          : Number.NaN;
    if (!Number.isFinite(numeric)) return { error: `配置项 ${field.key} 需要数字` };
    if (field.min !== undefined && numeric < field.min)
      return { error: `配置项 ${field.key} 小于最小值` };
    if (field.max !== undefined && numeric > field.max)
      return { error: `配置项 ${field.key} 大于最大值` };
    return numeric;
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return { error: `配置项 ${field.key} 需要布尔值` };
  }
  if (typeof value !== 'string' || value.length > MAX_CONFIG_VALUE_CHARS)
    return { error: `配置项 ${field.key} 不合法或过长` };
  if (field.type === 'enum' && !field.options?.includes(value))
    return { error: `配置项 ${field.key} 不在可选项里` };
  return value;
}
const within = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
export interface ExtensionPluginServiceOptions {
  root: string;
  hostVersion: string;
  hostPath: string;
  env: NodeJS.ProcessEnv;
  /** 清单声明的环境变量从这里取值；缺省与 env 相同 */
  sourceEnv?: NodeJS.ProcessEnv;
  capabilities?: PluginHostCapabilities;
  sessionBridge?: () => PluginSessionBridge | null;
  fork: PluginProcessDeps['fork'];
  gate: Omit<GateDeps, 'manifest' | 'config'>;
  market?: PluginMarket;
  /** 拉起动态工具时单个插件的等待上限 */
  prepareTimeoutMs?: number;
  /** 缺省开启；返回 false 时市场更新只提示，不安装 */
  autoUpdatePlugins?: () => boolean;
  devWatch?: (dir: string, onChange: () => void) => { close(): void };
  devReloadDelayMs?: number;
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
      systemPromptAppend?: string;
      systemPromptBoost?: string;
      refusalRetryPrompt?: string;
      model?: { providerId: string; modelId: string };
      thinkingLevel?: PluginPresetContrib['thinkingLevel'];
      approvalMode?: PluginPresetContrib['approvalMode'];
      disabledTools?: string[];
    }
  | { ok: false; error: string };

/** 会话注入 / 中止由 Main 的会话桥负责；注入成功与否必须由真实会话确认 */
export interface PluginSessionBridge {
  inject(
    sessionId: string,
    message: {
      pluginId: string;
      pluginName: string;
      text: string;
      images: PluginInjectImage[];
      deliverAs: 'steer' | 'followUp' | 'nextTurn';
      triggerTurn: boolean;
    }
  ): { ok: true } | { ok: false; error: string; notRunning?: boolean };
  abort(sessionId: string): { ok: true } | { ok: false; error: string };
}
export interface PluginToolOutcome {
  content: string;
  details?: unknown;
  artifacts: PluginArtifactInfo[];
}
interface ObserveLane {
  running: boolean;
  queue: {
    sessionId: string;
    projectRoot: string | null;
    generation?: string;
    data: unknown;
    agent?: PluginAgentSource;
  }[];
}

export class ExtensionPluginService {
  readonly gate: PluginHostGate;
  private records: PluginRecord[];
  private readonly loaded = new Map<string, ExtensionPluginManifest>();
  private readonly processes = new Map<string, PluginProcess>();
  private readonly staged = new Map<
    string,
    { staged: StagedPlugin; at: number; owner: number; source: PluginInstallSource }
  >();
  private readonly idTails = new Map<string, Promise<void>>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly observeLanes = new Map<string, ObserveLane>();
  private readonly interceptFailures = new Map<string, { failures: number; openUntil: number }>();
  private readonly prepareFailed = new Set<string>();
  private readonly progressTaps = new Map<string, (text: string) => void>();
  private readonly statusState = new Map<string, Record<string, StatusPatch>>();
  private readonly recentErrors = new Map<string, { at: number; message: string }>();
  private readonly updates = new Map<string, { version?: string; error?: string }>();
  private readonly injectDeniedNotified = new Set<string>();
  private readonly devWatchers = new Map<
    string,
    { close(): void; timer: ReturnType<typeof setTimeout> | null }
  >();
  private readonly residentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly starting = new Set<string>();
  private readonly scheduleRuns = new Map<
    string,
    {
      running: boolean;
      timer: ReturnType<typeof setInterval>;
      schedule: ExtensionPluginManifest['contributes']['schedules'][number];
      lastRunAt?: number;
      lastError?: string;
    }
  >();
  private readonly crashes = new Map<string, number[]>();
  private readonly uiCalls = new Map<
    string,
    { stamps: number[]; failures: number; openUntil: number }
  >();
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(notice: ExtensionPluginNotice) => void>();
  private noticeDismissed = false;
  private disposed = false;
  private readonly registryError: string | undefined;
  private readonly artifactStore: ArtifactStore;
  private readonly logger: PluginLogger;
  private readonly dynamic = new DynamicContribs();
  private readonly viewState: ViewStateStore;
  private readonly agentTypeWarned = new Set<string>();
  private background = false;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private disposeWait: Promise<void> | null = null;
  constructor(private readonly options: ExtensionPluginServiceOptions) {
    const registry = readRegistry(options.root);
    this.records = registry.plugins;
    this.registryError = registry.error;
    this.artifactStore = new ArtifactStore(join(options.root, 'artifacts'));
    this.logger = new PluginLogger(options.root);
    this.viewState = new ViewStateStore(options.root);
    // Tokens are memory-only. A restarted application can never commit abandoned staging data.
    rmSync(join(options.root, 'staging'), { recursive: true, force: true });
    this.gate = new PluginHostGate({
      ...options.gate,
      manifest: (id) => this.enabledManifest(id),
      config: (id) => this.pluginConfig(id),
      progress: (id, text) => this.progressTaps.get(id)?.(text),
      statusUpdate: (id, item, patch) => {
        const current = this.statusState.get(id) ?? {};
        this.statusState.set(id, { ...current, [item]: { ...current[item], ...patch } });
        this.changed();
      },
      writeArtifact: (id, input) => this.writeArtifact(id, input),
      registerContrib: (id, input) => this.registerContrib(id, input),
      unregisterContrib: (id, input) => this.unregisterContrib(id, input),
      crossSessionInject: (id) =>
        this.records.find((r) => r.id === id)?.crossSessionInject === true,
      onInjectDenied: (id) => {
        if (this.injectDeniedNotified.has(id)) return;
        this.injectDeniedNotified.add(id);
        this.emitNotice({
          kind: 'inject-denied',
          pluginId: id,
          name: this.installedManifest(id)?.name ?? id,
        });
      },
      inject: (id, input) => {
        const m = this.enabledManifest(id);
        const bridge = this.options.sessionBridge?.();
        return m && bridge
          ? bridge.inject(input.sessionId, { pluginId: id, pluginName: m.name, ...input })
          : { ok: false, error: '当前环境不能注入消息' };
      },
      abort: (id, sessionId) =>
        (this.enabledManifest(id) && this.options.sessionBridge?.()?.abort(sessionId)) || {
          ok: false,
          error: '当前环境不能中止会话',
        },
      callPlugin: (callerId, targetId, name, args, depth, caller) => {
        const target = this.enabledManifest(targetId);
        const exported = target?.contributes.exports.find((e) => e.name === name);
        if (!target) throw pluginError('PLUGIN_DISABLED', '目标插件未启用');
        if (!exported) throw pluginError('NOT_FOUND', '插件没有导出此方法');
        return this.invoke(
          targetId,
          'export.call',
          { name, args, caller: callerId },
          {
            ...caller,
            gesture: false,
            kind: 'export',
            depth,
            timeoutMs: exported.timeoutMs ?? 60_000,
          },
          caller.signal
        );
      },
      capabilities: () =>
        options.capabilities ?? {
          host: 'desktop',
          hostVersion: options.hostVersion,
          notify: true,
          mcp: true,
          clipboard: !!options.gate.clipboard,
          openExternal: !!options.gate.openExternal,
          composer: true,
        },
    });
  }
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onNotice(listener: (notice: ExtensionPluginNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
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
          // 安装代号：目录 + 清单指纹，重装或更新都会变，界面据此重载 ui.js
          build: this.fingerprint(r.dir, m).slice(0, 16),
          description: m.description,
          ...(m.icon ? { icon: m.icon } : {}),
          state: r.state,
          permissions: m.permissions,
          tools: m.contributes.agentTools.map(({ name, description }) => ({ name, description })),
          commands: m.contributes.commands,
          views: m.contributes.views,
          fileViewers: m.contributes.fileViewers.map((v) => ({
            id: v.id,
            title: v.title,
            entry: v.entry,
            extensions: [...v.extensions],
            default: v.default === true,
          })),
          statusItems: mergeStatusItems(
            m.contributes.statusItems,
            this.statusState.get(r.id) ?? {}
          ),
          themes: m.contributes.themes.map((t) => ({
            id: t.id,
            name: t.name,
            path: t.path,
            ...(t.css && r.grant.styles ? { css: t.css } : {}),
          })),
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
            ...(p.model ? { model: p.model } : {}),
          })),
          resident: m.resident,
          running: this.processes.get(r.id)?.running ?? false,
          ...(r.source
            ? {
                source:
                  r.source.kind === 'url'
                    ? { kind: 'url' as const, url: r.source.url }
                    : { kind: r.source.kind },
              }
            : {}),
          ...(r.source?.kind === 'dir' ? { devWatch: this.devWatchers.has(r.id) } : {}),
          ...(r.grant.permissions.includes('agent.inject')
            ? { crossSessionInject: r.crossSessionInject === true }
            : {}),
          ...((r.lastError ?? this.recentErrors.get(r.id))
            ? { lastError: r.lastError ?? this.recentErrors.get(r.id) }
            : {}),
          ...(this.updates.get(r.id)?.version
            ? { availableVersion: this.updates.get(r.id)?.version }
            : {}),
          ...(this.updates.get(r.id)?.error
            ? { updateCheckError: this.updates.get(r.id)?.error }
            : {}),
          ...(this.openInterceptBreakers(r.id).length
            ? { interceptBreakers: this.openInterceptBreakers(r.id) }
            : {}),
          ...(this.dynamic.commandsFor(r.id).length > 0
            ? {
                dynamicCommands: this.dynamic
                  .commandsFor(r.id)
                  .map(({ id, title }) => ({ id, title })),
              }
            : {}),
          events: m.contributes.events.map((e) => ({ event: e.event, mode: e.mode })),
          schedules: m.contributes.schedules.map((s) => {
            const state = this.scheduleRuns.get(`${r.id}\n${s.id}`);
            return {
              id: s.id,
              intervalSeconds: s.intervalSeconds,
              ...(state?.lastRunAt !== undefined ? { lastRunAt: state.lastRunAt } : {}),
              ...(state?.lastError ? { lastError: state.lastError } : {}),
            };
          }),
          ...(r.pending && pending
            ? {
                pendingVersion: r.pending.version,
                pendingPermissions: pending.permissions,
                ...(pending.renderer && !m.renderer ? { pendingRenderer: true } : {}),
              }
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
    // 市场来源：先按签名索引下载到临时 zip，再走统一的 zip 安装流程（安装阶段绝不执行插件代码）
    let resolved = source;
    let tempZip: string | null = null;
    if (source.kind === 'market') {
      const market = this.options.market;
      if (!market) return { ok: false as const, error: '当前环境不支持插件市场' };
      const dir = join(this.options.root, 'tmp');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      tempZip = join(dir, `market-${randomUUID()}.zip`);
      const downloaded = await market.download(source.id, source.version, tempZip, signal);
      if (!downloaded.ok) {
        rmSync(tempZip, { force: true });
        return { ok: false as const, error: downloaded.error };
      }
      resolved = { kind: 'zip', path: tempZip };
    }
    let result: Awaited<ReturnType<typeof stagePlugin>>;
    try {
      result = await stagePlugin(this.options.root, resolved, this.options.hostVersion, {
        signal,
      });
    } finally {
      if (tempZip) rmSync(tempZip, { force: true });
    }
    if (!result.ok) return result;
    if (this.disposed || signal?.aborted) {
      discardStaged(this.options.root, result.staged);
      return { ok: false as const, error: '应用已关闭' };
    }
    const { staged } = result;
    if (source.kind === 'market' && staged.manifest.id !== source.id) {
      discardStaged(this.options.root, staged);
      return { ok: false as const, error: `市场包里的插件不是 ${source.id}` };
    }
    this.staged.set(staged.token, { staged, at: Date.now(), owner, source });
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
      env: m.env,
      interop: m.interop.call,
      resident: m.resident,
      styles: m.contributes.themes.some((t) => t.css !== undefined),
      events: m.contributes.events.map((e) => ({
        event: e.event,
        mode: e.mode,
        failClosed: e.failClosed,
      })),
      schedules: m.contributes.schedules.map((s) => ({
        id: s.id,
        intervalSeconds: s.intervalSeconds,
      })),
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
  /**
   * 暂存与权限预览不执行插件代码。用户显式确认的首次安装随后走 setEnabled 的启用生命周期，
   * 但 `enabled` 只代表已授权启用，不代表 worker 已就绪；更新、重装与待批准保留原启停意图。
   */
  async commit(token: string, owner: number): Promise<ExtensionPluginCommitResult> {
    if (this.registryError) return { ok: false, error: this.registryError };
    this.sweepStaged();
    const entry = this.staged.get(token);
    if (!entry || entry.owner !== owner) return { ok: false, error: '安装已过期或不属于此窗口' };
    return this.withIdLock(entry.staged.manifest.id, () => this.commitEntry(token, owner));
  }
  private async commitEntry(token: string, owner: number): Promise<ExtensionPluginCommitResult> {
    const entry = this.staged.get(token);
    if (!entry || entry.owner !== owner || this.disposed)
      return { ok: false, error: '安装已过期或应用已关闭' };
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
    // 用户显式确认的首次安装安装完成后默认启用；更新、重装和内部安装保持原启用意图
    const firstInstall = !existing && owner !== INTERNAL_OWNER;
    if (!existing)
      this.records.push({
        id: m.id,
        version: m.version,
        dir,
        state: 'disabled',
        grant,
        installedAt: Date.now(),
        source: entry.source,
        crossSessionInject: false,
      });
    else {
      const oldDir = existing.dir;
      const stale = existing.pending?.dir;
      const expands = grantExpands(existing.grant, grant);
      this.apply(m.id, { type: 'update', version: m.version, dir, grant, expands });
      const updated = this.records.find((r) => r.id === m.id);
      if (updated) updated.source = entry.source;
      if (stale) removePackage(this.options.root, m.id, stale);
      if (!expands) {
        await this.stopProcessAndWait(m.id);
        removePackage(this.options.root, m.id, oldDir);
      } else {
        this.emitNotice({
          kind: 'update-needs-approval',
          pluginId: m.id,
          name: m.name,
          version: m.version,
        });
      }
    }
    this.prepareFailed.delete(m.id);
    this.clearInterceptBreakers(m.id);
    const available = this.updates.get(m.id)?.version;
    if (available && !isNewerPluginVersion(available, m.version)) this.updates.delete(m.id);
    this.persist();
    this.syncBackground();
    if (!firstInstall) return { ok: true };
    if (!this.load(m.id, dir))
      return {
        ok: true,
        enabled: false,
        warning: '安装目录里的插件清单无法读取，插件已安装但保持停用',
      };
    const enabled = this.enableEntry(m.id);
    return enabled.ok
      ? { ok: true, enabled: true }
      : { ok: true, enabled: false, warning: enabled.error };
  }
  async setEnabled(id: string, enabled: boolean) {
    if (this.registryError) return { ok: false, error: this.registryError };
    return this.withIdLock(id, async () => {
      if (enabled) return this.enableEntry(id);
      await this.stopProcessAndWait(id);
      const result = this.applyAndPersist(id, { type: 'disable' });
      if (result.ok) this.syncBackground();
      return result;
    });
  }
  /** 启用生命周期；调用方必须已持有该 id 的锁（不要在锁内再调 setEnabled）。 */
  private enableEntry(id: string): { ok: boolean; error?: string } {
    if (this.registryError) return { ok: false, error: this.registryError };
    this.crashes.delete(id);
    this.prepareFailed.delete(id);
    this.recentErrors.delete(id);
    const result = this.applyAndPersist(id, { type: 'enable' });
    if (result.ok) this.syncBackground();
    return result;
  }
  async approvePending(id: string) {
    if (this.registryError) return { ok: false, error: this.registryError };
    return this.withIdLock(id, async () => {
      const old = this.records.find((r) => r.id === id)?.dir;
      const result = this.applyAndPersist(id, { type: 'approve-pending' });
      if (result.ok && old) {
        this.prepareFailed.delete(id);
        await this.stopProcessAndWait(id);
        removePackage(this.options.root, id, old);
        this.syncBackground();
      }
      return result;
    });
  }
  async rejectPending(id: string) {
    if (this.registryError) return { ok: false, error: this.registryError };
    return this.withIdLock(id, async () => {
      const pending = this.records.find((r) => r.id === id)?.pending?.dir;
      const result = this.applyAndPersist(id, { type: 'reject-pending' });
      if (result.ok && pending) removePackage(this.options.root, id, pending);
      return result;
    });
  }
  async uninstall(id: string): Promise<{ ok: boolean; error?: string }> {
    if (this.registryError) return { ok: false, error: this.registryError };
    return this.withIdLock(id, () => this.uninstallEntry(id));
  }
  private async uninstallEntry(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.records.some((r) => r.id === id)) return { ok: false, error: '插件未安装' };
    this.records = this.records.filter((r) => r.id !== id);
    await this.stopProcessAndWait(id);
    this.persist();
    rmSync(join(this.options.root, 'packages', id), { recursive: true, force: true });
    rmSync(pluginDataPath(this.options.root, id), { recursive: true, force: true });
    rmSync(this.configPath(id), { force: true });
    this.artifactStore.removePlugin(id);
    this.viewState.remove(id);
    this.dynamic.clear(id);
    await this.logger.discard(id);
    this.closeDevWatch(id);
    this.statusState.delete(id);
    this.recentErrors.delete(id);
    this.prepareFailed.delete(id);
    this.updates.delete(id);
    this.syncBackground();
    this.crashes.delete(id);
    this.uiCalls.delete(id);
    for (const key of this.loaded.keys()) if (key.startsWith(`${id}/`)) this.loaded.delete(key);
    for (const [token, e] of this.staged)
      if (e.staged.manifest.id === id) this.discard(token, e.owner);
    return { ok: true };
  }
  /** 已保存的配置值（含密钥），按清单声明的类型收窄 */
  configValues(id: string): Record<string, ConfigValue> {
    const m = this.installedManifest(id);
    if (!m) return {};
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.configPath(id), 'utf8'));
    } catch {
      return {};
    }
    const out = Object.create(null) as Record<string, ConfigValue>;
    if (!raw || typeof raw !== 'object') return out;
    for (const f of m.contributes.configuration) {
      const v = (raw as Record<string, unknown>)[f.key];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[f.key] = v;
    }
    return out;
  }
  /** 给插件进程：类型化的当前值，缺省补上 default */
  pluginConfig(id: string): Record<string, ConfigValue> {
    const m = this.installedManifest(id);
    if (!m) return {};
    const stored = this.configValues(id);
    const out: Record<string, ConfigValue> = {};
    for (const f of m.contributes.configuration) {
      const value = stored[f.key];
      if (value !== undefined && configMatches(f, value)) out[f.key] = value;
      else if (f.default !== undefined) out[f.key] = f.default;
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
        ...(!f.secret && values[f.key] !== undefined ? { value: String(values[f.key]) } : {}),
      })),
    };
  }
  /** 省略的键不变，null 清除；只接受清单声明的键并按声明类型校验 */
  setConfig(
    id: string,
    patch: Record<string, string | number | boolean | null>
  ): { ok: boolean; error?: string } {
    if (this.registryError) return { ok: false, error: this.registryError };
    const m = this.installedManifest(id);
    if (!m) return { ok: false, error: '插件未安装' };
    const fields = new Map(m.contributes.configuration.map((f) => [f.key, f]));
    const next = this.configValues(id);
    for (const [k, v] of Object.entries(patch)) {
      const field = fields.get(k);
      if (!field) return { ok: false, error: `未知配置项 ${k}` };
      if (v === null) delete next[k];
      else {
        const parsed = coerceConfig(field, v);
        if (typeof parsed === 'object') return { ok: false, error: parsed.error };
        next[k] = parsed;
      }
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
    return this.enabled().flatMap(({ id, dir, manifest: m }) => [
      ...m.contributes.agentTools.map((t) => ({
        ...t,
        name: pluginToolName(id, t.name),
        pluginId: id,
        fingerprint: this.fingerprint(dir, m),
      })),
      ...this.dynamic.toolsFor(id).map((t) => ({
        ...t,
        name: pluginToolName(id, t.name),
        pluginId: id,
        fingerprint: this.fingerprint(dir, m),
      })),
    ]);
  }
  /** 无订阅也没有 agent.inject 时不给会话下发事件计划 */
  eventPlanForSpawn(): PluginEventPlan | null {
    const observe = new Set<string>();
    const intercept: { event: string; tools?: string[] }[] = [];
    let inject = false;
    for (const { manifest: m } of this.enabled()) {
      if (m.permissions.includes('agent.inject')) inject = true;
      for (const sub of m.contributes.events) {
        // 宿主汇总派发的事件不经 worker
        if (isHostPluginEvent(sub.event)) continue;
        if (sub.mode === 'observe') {
          observe.add(sub.event);
          continue;
        }
        const existing = intercept.find((item) => item.event === sub.event);
        if (!existing) {
          intercept.push({ event: sub.event, ...(sub.tools ? { tools: [...sub.tools] } : {}) });
          continue;
        }
        if (!sub.tools || !existing.tools) delete existing.tools;
        else existing.tools = [...new Set([...existing.tools, ...sub.tools])];
      }
    }
    if (observe.size === 0 && intercept.length === 0 && !inject) return null;
    return { observe: [...observe].sort(), intercept, inject };
  }
  /** Dynamic tools must be registered before worker receives its tool snapshot. */
  async prepareForSpawn(): Promise<void> {
    await Promise.all(
      this.enabled()
        .filter(({ manifest }) => manifest.main && manifest.contributes.dynamic.tools > 0)
        .map(async ({ id }) => {
          if (this.prepareFailed.has(id) || this.disposed) return;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const ready = this.processFor(id).ready();
            void ready.then(
              () => this.prepareFailed.delete(id),
              () => undefined
            );
            await Promise.race([
              ready,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(pluginError('TIMEOUT', '动态工具准备超时')),
                  this.options.prepareTimeoutMs ?? 5000
                );
              }),
            ]);
            this.prepareFailed.delete(id);
          } catch {
            this.prepareFailed.add(id);
          } finally {
            if (timer) clearTimeout(timer);
          }
        })
    );
  }
  async dispatchEvent(input: {
    sessionId: string;
    projectRoot: string | null;
    generation?: string;
    event: PluginEventName;
    data: unknown;
    agent?: PluginAgentSource;
  }): Promise<void> {
    const targets = this.enabled().filter(({ manifest }) =>
      manifest.contributes.events.some((sub) => sub.event === input.event && sub.mode === 'observe')
    );
    if (input.event === 'before_compact' && !input.agent) {
      await Promise.all(
        targets
          .filter(({ id }) => this.canDeliverObserve(id))
          .map(({ id }) =>
            this.invoke(
              id,
              'event.dispatch',
              { event: input.event, data: input.data },
              {
                ...input,
                sessionGeneration: input.generation,
                gesture: false,
                kind: 'event',
                timeoutMs: BEFORE_COMPACT_TIMEOUT_MS,
              }
            ).catch((error) =>
              this.appendLog(id, 'warn', `事件 ${input.event} 失败：${String(error)}`)
            )
          )
      );
      return;
    }
    for (const { id } of targets) this.enqueueObserve(id, input);
  }
  async intercept<E extends PluginInterceptEvent>(input: {
    sessionId: string;
    projectRoot: string | null;
    generation?: string;
    event: E;
    payload: InterceptPayload[E];
    deadlineMs?: number;
    agent?: PluginAgentSource;
  }): Promise<InterceptResult[E]> {
    let state = initialInterceptState(input.event, input.payload);
    const child = input.agent !== undefined;
    if (child && !isChildInterceptEvent(input.event)) return state.result;
    const deadline =
      Date.now() +
      (input.deadlineMs ?? (child ? CHILD_INTERCEPT_TOTAL_TIMEOUT_MS : INTERCEPT_TOTAL_TIMEOUT_MS));
    const eventKey = `${child ? 'child:' : ''}${input.event}`;
    const targets = this.enabled()
      .filter(({ manifest }) =>
        manifest.contributes.events.some(
          (sub) =>
            sub.event === input.event &&
            sub.mode === 'intercept' &&
            (!sub.tools ||
              !('toolName' in input.payload) ||
              sub.tools.includes(input.payload.toolName))
        )
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const { id, manifest } of targets) {
      if (state.done) break;
      const key = `${id}:${eventKey}`;
      const breaker = this.interceptFailures.get(key);
      const sub = manifest.contributes.events.find(
        (s) => s.event === input.event && s.mode === 'intercept'
      );
      if (breaker && Date.now() < breaker.openUntil) {
        if (sub?.failClosed) return failClosedResult(input.event, manifest.name);
        continue;
      }
      const remaining = deadline - Date.now();
      try {
        if (remaining <= 0) throw pluginError('DEADLINE', '拦截总时长已用尽');
        const value = await this.invoke(
          id,
          'event.dispatch',
          { event: input.event, data: state.payload },
          {
            sessionId: input.sessionId,
            projectRoot: input.projectRoot,
            sessionGeneration: input.generation,
            agent: input.agent,
            gesture: false,
            kind: 'event',
            timeoutMs: Math.min(
              remaining,
              child ? CHILD_INTERCEPT_TIMEOUT_MS : INTERCEPT_TIMEOUT_MS
            ),
          }
        );
        state = applyInterceptResult(state, value);
        if (this.interceptFailures.delete(key) && breaker?.openUntil) {
          this.appendLog(id, 'info', `插件 ${manifest.name} 的 ${eventKey} 检查已恢复`);
          this.changed();
        }
      } catch (error) {
        this.appendLog(id, 'warn', `拦截 ${input.event} 失败：${String(error)}`);
        if (remaining > 0) {
          const next = { failures: (breaker?.failures ?? 0) + 1, openUntil: 0 };
          if (next.failures >= 3) {
            next.openUntil = Date.now() + 30_000;
            this.appendLog(
              id,
              'warn',
              `插件 ${manifest.name} 的 ${eventKey} 检查连续失败，已熔断 30 秒（${sub?.failClosed ? '继续拒绝' : '临时放行'}）`
            );
          }
          this.interceptFailures.set(key, next);
          this.changed();
        }
        if (sub?.failClosed) return failClosedResult(input.event, manifest.name);
      }
    }
    return state.result;
  }
  private openInterceptBreakers(id: string): { event: string; until: number }[] {
    return [...this.interceptFailures].flatMap(([key, state]) =>
      key.startsWith(`${id}:`) && Date.now() < state.openUntil
        ? [{ event: key.slice(id.length + 1), until: state.openUntil }]
        : []
    );
  }
  private clearInterceptBreakers(id: string): void {
    for (const key of this.interceptFailures.keys())
      if (key.startsWith(`${id}:`)) this.interceptFailures.delete(key);
  }
  private canDeliverObserve(id: string): boolean {
    const m = this.enabledManifest(id);
    return !!m?.main && (m.resident || this.processes.get(id)?.running === true);
  }
  private enqueueObserve(
    id: string,
    input: {
      sessionId: string;
      projectRoot: string | null;
      generation?: string;
      event: PluginEventName;
      data: unknown;
      agent?: PluginAgentSource;
    }
  ): void {
    if (this.disposed || !this.canDeliverObserve(id)) return;
    const key = `${id}\0${input.event}\0${input.sessionId}\0${input.generation ?? ''}\0${input.agent ? `${input.agent.kind}\0${input.agent.sessionId}\0${input.agent.name}` : ''}`;
    const lane = this.observeLanes.get(key) ?? { running: false, queue: [] };
    this.observeLanes.set(key, lane);
    if ((input.event === 'context_usage' || input.event === 'tool_result') && lane.queue.length)
      lane.queue[lane.queue.length - 1] = input;
    else {
      if (lane.queue.length >= 32) lane.queue.shift();
      lane.queue.push(input);
    }
    if (lane.running) return;
    lane.running = true;
    void this.drainObserve(id, input.event, key, lane);
  }
  private async drainObserve(
    id: string,
    event: PluginEventName,
    key: string,
    lane: ObserveLane
  ): Promise<void> {
    for (;;) {
      const job = lane.queue.shift();
      if (!job) {
        lane.running = false;
        if (this.observeLanes.get(key) === lane) this.observeLanes.delete(key);
        return;
      }
      if (this.disposed || !this.canDeliverObserve(id)) continue;
      try {
        await this.invoke(
          id,
          'event.dispatch',
          { event, data: job.data },
          {
            ...job,
            sessionGeneration: job.generation,
            gesture: false,
            kind: 'event',
            timeoutMs: OBSERVE_TIMEOUT_MS,
          }
        );
      } catch (error) {
        this.appendLog(id, 'warn', `事件 ${event} 失败：${String(error)}`);
      }
    }
  }
  /** 运行期注册工具 / 命令；配额与形状按清单校验 */
  registerContrib(id: string, input: Record<string, unknown>): void {
    const m = this.enabledManifest(id);
    if (!m) throw pluginError('PLUGIN_DISABLED', '插件未启用');
    this.dynamic.register(id, m, input);
    this.changed();
  }
  unregisterContrib(id: string, input: Record<string, unknown>): void {
    this.dynamic.unregister(id, input);
    this.changed();
  }
  async writeArtifact(pluginId: string, input: Record<string, unknown>) {
    if (!this.installedManifest(pluginId)) throw pluginError('NOT_FOUND', '插件未安装');
    return this.artifactStore.write(pluginId, input);
  }
  listArtifacts(pluginId?: string): PluginArtifactInfo[] {
    return this.artifactStore.list(pluginId);
  }
  artifactInfo(id: string): PluginArtifactInfo | null {
    return this.artifactStore.info(id);
  }
  artifactPath(id: string): string | null {
    return this.artifactStore.path(id);
  }
  deleteArtifact(id: string): boolean {
    return this.artifactStore.delete(id);
  }
  appendLog(id: string, level: PluginLogLevel, message: string): void {
    this.logger.append(id, level, message);
    if (level === 'error') this.recordError(id, message);
  }
  recordError(id: string, message: string): void {
    this.recentErrors.set(id, { at: Date.now(), message: message.slice(0, 2000) });
  }
  logs(id: string, maxBytes = DEFAULT_LOG_TAIL_BYTES): Promise<string> {
    return this.logger.read(id, maxBytes);
  }
  viewStateGet(pluginId: string): Record<string, string> {
    return this.viewState.get(pluginId);
  }
  viewStateSet(
    pluginId: string,
    patch: Record<string, string | null>
  ): { ok: boolean; error?: string } {
    const result = this.viewState.set(pluginId, patch);
    if (result.ok) this.changed();
    return result;
  }
  /**
   * 登记表读不出时提示用户：插件列表可能不全，原文已备份。
   * 用户确认后不再提示，直到登记表再次损坏。
   */
  registryNotice(): RegistryNotice | null {
    if (!this.registryError) return null;
    if (this.noticeDismissed) return null;
    return { discarded: [], unreadable: true };
  }
  dismissRegistryNotice(): void {
    this.noticeDismissed = true;
  }
  /** 已安装插件的使用说明 */
  readme(id: string, from: 'installed' | 'market'): ReadmeResult | Promise<ReadmeResult> {
    if (from === 'market') {
      const market = this.options.market;
      if (!market) return { ok: false, error: '当前环境不支持插件市场' };
      return market.readme(id);
    }
    const r = this.records.find((record) => record.id === id);
    if (!r) return { ok: false, error: '插件未安装' };
    return readPackageReadme(pluginPackagePath(this.options.root, r.id, r.dir));
  }
  /** 只按 Main 记录的来源重装，不接受 renderer 指定路径。 */
  async restage(id: string, owner: number, signal?: AbortSignal) {
    return this.withIdLock(id, async () => {
      const source = this.records.find((r) => r.id === id)?.source;
      if (!source) return { ok: false as const, error: '没有记录安装来源，请重新选择插件' };
      const result = await this.stage(
        source.kind === 'market' ? { kind: 'market', id } : source,
        owner,
        signal
      );
      if (result.ok && result.preview.id !== id) {
        this.discard(result.preview.token, owner);
        return { ok: false as const, error: `来源里的插件已经不是 ${id}` };
      }
      return result;
    });
  }
  async marketList(refresh: boolean): Promise<ExtensionPluginMarketList> {
    const market = this.options.market;
    if (!market) return { ok: false, error: '当前环境不支持插件市场', chinaMirror: false };
    const chinaMirror = market.chinaMirror();
    const r = await market.index({ refresh });
    if (!r.ok) return { ok: false, error: r.error, chinaMirror };
    const plugins = r.index.plugins.map((p) => {
      const installed = this.records.find((item) => item.id === p.id)?.version;
      const icon = marketIconUrl(p.icon);
      const screenshots = p.screenshots?.flatMap((shot) => {
        const url = marketIconUrl(shot.url);
        return url ? [{ url, alt: shot.alt }] : [];
      });
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        tier: p.tier,
        tags: p.tags,
        ...(p.homepage ? { homepage: p.homepage } : {}),
        ...(icon ? { icon } : {}),
        ...(p.category ? { category: p.category } : {}),
        ...(screenshots?.length ? { screenshots } : {}),
        latest: p.latest,
        permissions: p.versions.find((v) => v.version === p.latest)?.permissions ?? [],
        ...(installed ? { installedVersion: installed } : {}),
        updateAvailable:
          installed !== undefined ? isNewerPluginVersion(p.latest, installed) : false,
      };
    });
    return { ok: true, stale: r.stale, chinaMirror, plugins };
  }
  setMarketChinaMirror(on: boolean): void {
    this.options.market?.setChinaMirror(on);
  }
  async checkUpdates(options: { enabledOnly?: boolean } = {}) {
    if (this.disposed || this.registryError) return { checked: 0, available: 0, failed: 0 };
    const records = this.records.filter((r) => !options.enabledOnly || r.state === 'enabled');
    const results: ('available' | 'current' | 'failed')[] = [];
    if (this.options.market && records.some((r) => r.source?.kind !== 'url')) {
      const index = await this.options.market.index({ refresh: true });
      for (const record of records.filter((r) => r.source?.kind !== 'url')) {
        if (!index.ok) {
          if (record.source?.kind === 'market') {
            this.updates.set(record.id, { error: index.error });
            results.push('failed');
          }
          continue;
        }
        const entry = index.index.plugins.find((p) => p.id === record.id);
        if (!entry && record.source?.kind !== 'market') continue;
        const version =
          entry && isNewerPluginVersion(entry.latest, record.version) ? entry.latest : undefined;
        this.updates.set(record.id, version ? { version } : {});
        if (
          !version ||
          record.source?.kind !== 'market' ||
          this.options.autoUpdatePlugins?.() === false
        ) {
          results.push(version ? 'available' : 'current');
          continue;
        }
        results.push(await this.installMarketUpdate(record.id, version));
      }
    }
    await Promise.all(
      records.map(async (record) => {
        if (record.source?.kind !== 'url') return;
        const probe = pluginManifestProbeUrl(new URL(record.source.url));
        if (!probe) return;
        const tmpDir = join(this.options.root, 'tmp');
        mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
        const path = join(tmpDir, `probe-${randomUUID()}`);
        try {
          // Never use global fetch: redirects and each DNS answer must stay pinned.
          await downloadPluginArchive(probe, path, { maxBytes: 256 * 1024, timeoutMs: 15_000 });
          const parsed = parseExtensionPluginManifest(
            JSON.parse(readFileSync(path, 'utf8')),
            this.options.hostVersion
          );
          if (!parsed.ok || parsed.manifest.id !== record.id)
            throw new Error('远端清单不可用或插件身份已变化');
          const version = isNewerPluginVersion(parsed.manifest.version, record.version)
            ? parsed.manifest.version
            : undefined;
          this.updates.set(record.id, version ? { version } : {});
          results.push(version ? 'available' : 'current');
        } catch (error) {
          this.updates.set(record.id, {
            error: error instanceof Error ? error.message : '检查更新失败',
          });
          results.push('failed');
        } finally {
          rmSync(path, { force: true });
        }
      })
    );
    this.changed();
    return {
      checked: results.length,
      available: results.filter((r) => r === 'available').length,
      failed: results.filter((r) => r === 'failed').length,
    };
  }
  private async installMarketUpdate(
    id: string,
    version: string
  ): Promise<'available' | 'current' | 'failed'> {
    if (this.records.find((r) => r.id === id)?.pending?.version === version) return 'available';
    const result = await this.stage({ kind: 'market', id, version }, INTERNAL_OWNER);
    if (!result.ok) {
      this.updates.set(id, { version, error: result.error });
      return 'failed';
    }
    if (!result.preview.expands && (this.processes.get(id)?.inflight ?? 0) > 0) {
      this.discard(result.preview.token, INTERNAL_OWNER);
      return 'available';
    }
    const committed = await this.commit(result.preview.token, INTERNAL_OWNER);
    if (!committed.ok) {
      this.updates.set(id, { version, error: committed.error });
      return 'failed';
    }
    if (result.preview.expands) {
      this.updates.set(id, { version });
      return 'available';
    }
    this.emitNotice({
      kind: 'auto-updated',
      pluginId: id,
      name: result.preview.name,
      version: result.preview.version,
    });
    return 'current';
  }
  setCrossSessionInject(id: string, allowed: boolean): { ok: boolean; error?: string } {
    if (this.registryError) return { ok: false, error: this.registryError };
    const record = this.records.find((r) => r.id === id);
    if (!record) return { ok: false, error: '插件未安装' };
    if (!record.grant.permissions.includes('agent.inject'))
      return { ok: false, error: '插件没有申请 agent.inject' };
    record.crossSessionInject = allowed;
    this.injectDeniedNotified.delete(id);
    this.persist();
    return { ok: true };
  }
  setDevWatch(id: string, on: boolean): { ok: boolean; error?: string } {
    if (this.registryError) return { ok: false, error: this.registryError };
    const source = this.records.find((r) => r.id === id)?.source;
    if (source?.kind !== 'dir') return { ok: false, error: '只有从目录安装的插件能开开发模式' };
    if (!on) {
      this.closeDevWatch(id);
      this.changed();
      return { ok: true };
    }
    if (this.devWatchers.has(id)) return { ok: true };
    const entry: { close(): void; timer: ReturnType<typeof setTimeout> | null } = {
      close() {},
      timer: null,
    };
    try {
      const watcher = (
        this.options.devWatch ??
        ((dir, cb) => {
          const w = watch(dir, { recursive: true }, (_event, filename) => {
            if (!filename || !DEV_IGNORED.test(String(filename))) cb();
          });
          w.on('error', (error) => this.appendLog(id, 'error', `开发监听失败：${error.message}`));
          return { close: () => w.close() };
        })
      )(source.path, () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void this.devReloadNow(id).catch((error) => this.appendLog(id, 'error', String(error)));
        }, this.options.devReloadDelayMs ?? 400);
      });
      entry.close = () => watcher.close();
      this.devWatchers.set(id, entry);
      this.changed();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `监听目录失败：${String(error)}` };
    }
  }
  async devReloadNow(id: string): Promise<void> {
    const result = await this.restage(id, INTERNAL_OWNER);
    if (!result.ok) {
      this.recordError(id, `开发模式重装失败：${result.error}`);
      this.changed();
      return;
    }
    if (result.preview.expands) {
      this.discard(result.preview.token, INTERNAL_OWNER);
      this.recordError(id, '开发模式：新清单授权扩大，需要手动从来源重新安装并同意');
      this.changed();
      return;
    }
    const committed = await this.commit(result.preview.token, INTERNAL_OWNER);
    if (!committed.ok) this.recordError(id, `开发模式重装失败：${committed.error}`);
    else this.recentErrors.delete(id);
    this.changed();
  }
  private closeDevWatch(id: string): void {
    const entry = this.devWatchers.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.close();
    this.devWatchers.delete(id);
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
  /** workflow 预设文件的绝对路径，与 skill 同口径按插件预设圈定 */
  workflowPathsForSpawn(activePresetId?: string): string[] {
    return this.enabled().flatMap(({ id, dir, manifest: m }) => {
      const root = pluginPackagePath(this.options.root, id, dir);
      const selection = this.selection(m, id, activePresetId, (p) => p.workflows ?? []);
      return m.contributes.workflows
        .filter((rel) => !selection.scoped.has(rel) || selection.selected.has(rel))
        .map((rel) => resolve(root, rel));
    });
  }
  /**
   * 已启用插件声明的子代理类型；正文读不出的跳过并记日志。
   * 传 scope 时按会话生效的插件预设过滤；不传则列出全部（设置页、派发）。
   */
  agentTypesForSpawn(scope?: { activePresetId?: string }): NativePluginAgentDef[] {
    return this.enabled().flatMap(({ id, dir, manifest: m }) => {
      const root = pluginPackagePath(this.options.root, id, dir);
      const selection = this.selection(m, id, scope?.activePresetId, (p) => p.agentTypes ?? []);
      return m.contributes.agentTypes.flatMap((type) => {
        if (scope && selection.scoped.has(type.name) && !selection.selected.has(type.name))
          return [];
        const prompt = readPluginText(root, type.systemPrompt);
        if (prompt === null) {
          this.warnAgentTypeOnce(
            id,
            `子代理类型 ${type.name} 的 systemPrompt（${type.systemPrompt}）读取失败，已跳过`
          );
          return [];
        }
        return [
          {
            pluginId: id,
            name: type.name,
            description: type.description,
            systemPrompt: prompt,
            tools: type.tools,
            skillPaths: type.skills.map((rel) => resolve(root, rel)),
            ...(type.modelMode ? { modelMode: type.modelMode } : {}),
          },
        ];
      });
    });
  }
  /** 供 pluginRuntime 合并子代理类型；被重名丢弃的写进对应插件日志 */
  agentTypeSource(): NativeAgentTypeSource {
    return {
      list: () => this.agentTypesForSpawn(),
      reportDropped: (dropped: PluginAgentTypeDrop[]) => {
        for (const drop of dropped) {
          if (!drop.pluginId) continue;
          const by =
            drop.shadowedBy === 'custom'
              ? '用户自定义类型'
              : drop.shadowedBy === 'claude'
                ? 'Claude 插件'
                : drop.shadowedBy === 'native'
                  ? '排序更前的 Enso 插件'
                  : '内置类型或保留名';
          this.warnAgentTypeOnce(drop.pluginId, `子代理类型 ${drop.name} 与${by}同名，已被忽略`);
        }
      },
    };
  }
  private warnAgentTypeOnce(id: string, message: string): void {
    const key = `${id}\0${message}`;
    if (this.agentTypeWarned.has(key)) return;
    this.agentTypeWarned.add(key);
    this.appendLog(id, 'warn', message);
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
      ['systemPromptTail', 'systemPromptAppend'],
      ['boostPrompt', 'systemPromptBoost'],
      ['refusalRetryPrompt', 'refusalRetryPrompt'],
    ] as const;
    for (const [key, target] of fields) {
      const rel = p[key];
      if (!rel) continue;
      if (key === 'refusalRetryPrompt' && !p.refusalRetry) continue;
      const content = readPluginText(root, rel);
      if (content === null) return { ok: false, error: '插件预设正文读取失败，请重新安装。' };
      if (target === 'instruction') result.instruction = { path: join(root, rel), content };
      else result[target] = content;
    }
    if (p.model) result.model = p.model;
    if (p.thinkingLevel) result.thinkingLevel = p.thinkingLevel;
    if (p.approvalMode) result.approvalMode = p.approvalMode;
    if (p.disabledTools?.length) result.disabledTools = [...p.disabledTools];
    return result;
  }
  async callTool(input: {
    toolName: string;
    fingerprint: string;
    args: unknown;
    sessionId: string;
    projectRoot: string | null;
    generation?: string;
    signal?: AbortSignal;
    onProgress?: (text: string) => void;
    agent?: PluginAgentSource;
  }): Promise<PluginToolOutcome> {
    const parsed = parsePluginToolName(input.toolName);
    if (!parsed) throw pluginError('NOT_FOUND', '不是插件工具');
    const m = this.enabledManifest(parsed.pluginId);
    if (!m) throw pluginError('PLUGIN_DISABLED', '插件未启用');
    const r = this.records.find((r) => r.id === parsed.pluginId)!;
    if (!input.fingerprint || input.fingerprint !== this.fingerprint(r.dir, m))
      throw pluginError('STALE_PLUGIN', '插件已更新，请重新加载会话工具');
    let declared =
      m.contributes.agentTools.find((t) => t.name === parsed.toolName) ??
      this.dynamic.toolsFor(parsed.pluginId).find((t) => t.name === parsed.toolName);
    if (!declared && m.main && m.contributes.dynamic.tools > 0) {
      await this.processFor(parsed.pluginId).ready();
      declared = this.dynamic.toolsFor(parsed.pluginId).find((t) => t.name === parsed.toolName);
    }
    if (!declared) throw pluginError('NOT_DECLARED', '插件未声明工具');
    const value = await this.invoke(
      parsed.pluginId,
      'tool.execute',
      { name: parsed.toolName, args: input.args },
      {
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        sessionGeneration: input.generation,
        gesture: false,
        timeoutMs: declared.timeoutMs ?? 60_000,
        kind: 'tool',
        onProgress: input.onProgress,
        agent: input.agent,
        fingerprint: input.fingerprint,
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
    const result = value as PluginToolResult;
    return {
      content: result.content,
      ...(result.details !== undefined ? { details: result.details } : {}),
      artifacts: (Array.isArray(result.artifacts) ? result.artifacts : []).flatMap((id) => {
        const info = typeof id === 'string' ? this.artifactStore.info(id) : null;
        return info?.pluginId === parsed.pluginId ? [info] : [];
      }),
    };
  }
  async callUi(input: {
    pluginId: string;
    method: UiCallMethod;
    payload: Record<string, unknown>;
    sessionId: string | null;
    projectRoot: string | null;
    generation?: string;
    origin?: number | null;
    gesture?: boolean;
    remote?: boolean;
  }): Promise<unknown> {
    const m = this.enabledManifest(input.pluginId);
    if (!m) throw pluginError('PLUGIN_DISABLED', '插件未启用');
    const declared =
      input.method === 'command.run'
        ? m.contributes.commands.some((c) => c.id === input.payload.id) ||
          this.dynamic.commandsFor(input.pluginId).some((c) => c.id === input.payload.id)
        : input.method === 'renderer.call'
          ? m.permissions.includes('ui.slot') || m.permissions.includes('ui.view')
          : m.contributes.triggers.some((t) => t.name === input.payload.name);
    if (!declared) throw pluginError('NOT_DECLARED', '清单未声明能力');
    if (Buffer.byteLength(JSON.stringify(input.payload)) > 1024 * 1024)
      throw pluginError('TOO_LARGE', '参数超过 1MB');
    this.admitUiCall(input.pluginId);
    // Typing # and fetching candidates is NOT a gesture authorizing composer mutation.
    const gesture = input.gesture === true && input.method !== 'trigger.candidates';
    try {
      const value = await this.invoke(input.pluginId, input.method, input.payload, {
        sessionId: input.sessionId,
        projectRoot: input.projectRoot,
        sessionGeneration: input.generation,
        gesture,
        origin: input.origin ?? null,
        remote: input.remote === true,
        kind: 'ui',
        timeoutMs: uiCallTimeout(m, input.method, input.payload),
      });
      if (Buffer.byteLength(JSON.stringify(value ?? null)) > 1024 * 1024)
        throw pluginError('TOO_LARGE', '返回值超过 1MB');
      this.settleUiCall(input.pluginId, true);
      return value;
    } catch (e) {
      this.settleUiCall(input.pluginId, false);
      throw e;
    }
  }
  assetPath(pluginId: string, rel: string): string | null {
    const r = this.records.find((r) => r.id === pluginId);
    const m = this.installedManifest(pluginId);
    if (
      !r ||
      !m ||
      !isPluginRelativePath(rel) ||
      !(
        rel === m.icon ||
        (r.state === 'enabled' &&
          (rel === m.renderer ||
            m.contributes.views.some((v) => v.entry === rel) ||
            m.contributes.fileViewers.some((v) => v.entry === rel) ||
            this.viewAssetAllowed(m, rel) ||
            m.contributes.themes.some((t) => t.path === rel || (r.grant.styles && t.css === rel))))
      )
    )
      return null;
    const root = pluginPackagePath(this.options.root, r.id, r.dir);
    try {
      const path = realpathSync(resolve(root, rel));
      const info = statSync(path);
      return within(realpathSync(root), path) &&
        info.isFile() &&
        info.nlink === 1 &&
        info.size <= 8 * 1024 * 1024
        ? path
        : null;
    } catch {
      return null;
    }
  }
  /** CSS url() resources: media only, contained in an explicitly declared theme directory. */
  private viewAssetAllowed(manifest: ExtensionPluginManifest, rel: string): boolean {
    if (!/\.(?:js|css|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf)$/i.test(rel))
      return false;
    return [...manifest.contributes.views, ...manifest.contributes.fileViewers].some((view) => {
      const dir = dirname(view.entry).replaceAll('\\', '/');
      return dir === '.' || rel.startsWith(`${dir}/`);
    });
  }
  assetMediaPath(pluginId: string, rel: string): string | null {
    const r = this.records.find((record) => record.id === pluginId);
    const m = this.enabledManifest(pluginId);
    if (
      !r ||
      !m ||
      !isPluginRelativePath(rel) ||
      !/^\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot)$/i.test(extname(rel))
    )
      return null;
    const root = pluginPackagePath(this.options.root, pluginId, r.dir);
    try {
      const base = realpathSync(root);
      const path = realpathSync(resolve(root, rel));
      const info = statSync(path);
      if (!within(base, path) || !info.isFile() || info.nlink !== 1 || info.size > 20 * 1024 * 1024)
        return null;
      return m.contributes.themes.some((theme) => {
        const declared = [theme.path, ...(r.grant.styles && theme.css ? [theme.css] : [])];
        return declared.some((entry) => {
          const dir = realpathSync(resolve(root, dirname(entry)));
          return within(base, dir) && within(dir, path);
        });
      })
        ? path
        : null;
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
      const result = this.apply(id, { type: 'crash' });
      if (result.ok) {
        const record = this.records.find((r) => r.id === id);
        if (record)
          record.lastError = this.recentErrors.get(id) ?? {
            at: Date.now(),
            message: '插件进程反复异常退出',
          };
        this.persist();
        this.syncBackground();
      }
    }
  }
  /**
   * 进入后台运行阶段：拉起常驻插件（失败只记日志，不影响应用启动）。
   * 定时任务同常驻进程一起启用，更新检查单独受用户设置控制。
   */
  startBackground(): void {
    if (this.disposed || this.background) return;
    this.background = true;
    this.syncBackground();
  }
  hasRunningPlugins(): boolean {
    return [...this.processes.values()].some((proc) => proc.running);
  }
  /** 稍后首次检查，然后每天检查；不重叠运行。 */
  startUpdateChecks(): void {
    if (this.disposed || this.updateTimer) return;
    const arm = (delay: number) => {
      if (this.disposed) return;
      this.updateTimer = setTimeout(() => {
        void this.checkUpdates({ enabledOnly: true })
          .catch(() => undefined)
          .finally(() => arm(24 * 60 * 60_000));
      }, delay);
      this.updateTimer.unref?.();
    };
    arm(60_000);
  }
  dispose(): Promise<void> {
    if (this.disposeWait) return this.disposeWait;
    this.disposed = true;
    this.background = false;
    for (const id of this.devWatchers.keys()) this.closeDevWatch(id);
    for (const timer of this.residentTimers.values()) clearTimeout(timer);
    this.residentTimers.clear();
    this.armSchedules();
    for (const id of [...this.processes.keys()]) this.stopProcess(id);
    for (const [token, e] of this.staged) this.discard(token, e.owner);
    this.gate.dispose();
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.updateTimer = null;
    this.disposeWait = Promise.all([...this.stopping.values(), this.logger.dispose()]).then(
      () => undefined
    );
    this.listeners.clear();
    this.loaded.clear();
    this.uiCalls.clear();
    this.crashes.clear();
    this.noticeListeners.clear();
    return this.disposeWait;
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
      remote?: boolean;
      timeoutMs: number;
      kind?: 'tool' | 'ui' | 'event' | 'schedule' | 'export';
      depth?: number;
      onProgress?: (text: string) => void;
      agent?: PluginAgentSource;
      fingerprint?: string;
      sessionGeneration?: string;
    },
    signal?: AbortSignal
  ): Promise<unknown> {
    if (signal?.aborted) throw pluginError('ABORTED', '调用已取消');
    await this.stopping.get(pluginId);
    if (signal?.aborted) throw pluginError('ABORTED', '调用已取消');
    if (ctx.fingerprint) {
      const record = this.records.find((r) => r.id === pluginId);
      const manifest = this.enabledManifest(pluginId);
      if (!record || !manifest || ctx.fingerprint !== this.fingerprint(record.dir, manifest))
        throw pluginError('STALE_PLUGIN', '插件已更新，请重新加载会话工具');
    }
    const proc = this.processFor(pluginId);
    const invocationId = this.gate.invocations.create({
      pluginId,
      sessionId: ctx.sessionId,
      projectRoot: ctx.projectRoot,
      sessionGeneration: ctx.sessionGeneration,
      agent: ctx.agent,
      gesture: ctx.gesture,
      origin: ctx.origin ?? null,
      remote: ctx.remote === true,
      kind: ctx.kind,
      depth: ctx.depth,
    });
    if (ctx.onProgress) {
      let last = Number.NEGATIVE_INFINITY;
      this.progressTaps.set(invocationId, (text) => {
        const now = Date.now();
        if (now - last < 200) return;
        last = now;
        ctx.onProgress?.(text.slice(0, PLUGIN_PROGRESS_MAX_CHARS));
      });
    }
    let rejectWait: (error: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectWait = reject;
    });
    const onAbort = () => {
      this.gate.invocations.cancel(invocationId);
      proc.cancel(invocationId);
      rejectWait(pluginError('ABORTED', '调用已取消'));
    };
    const timeout = setTimeout(() => {
      this.gate.invocations.cancel(invocationId);
      proc.cancel(invocationId);
      rejectWait(pluginError('TIMEOUT', '插件调用超时'));
    }, ctx.timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.race([
        cancelled,
        proc.call(method, payload, {
          invocationId,
          sessionId: ctx.sessionId,
          projectRoot: ctx.projectRoot,
          timeoutMs: ctx.timeoutMs,
          ...(ctx.agent ? { agent: ctx.agent } : {}),
        }),
      ]);
    } catch (e) {
      this.gate.invocations.cancel(invocationId);
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      this.gate.invocations.finish(invocationId);
      this.progressTaps.delete(invocationId);
    }
  }
  private processFor(id: string): PluginProcess {
    if (this.disposed || !this.enabledManifest(id))
      throw pluginError('PLUGIN_DISABLED', '插件未启用或服务已关闭');
    if (this.stopping.has(id)) throw pluginError('PLUGIN_STOPPING', '旧插件进程尚未退出');
    const existing = this.processes.get(id);
    if (existing) return existing;
    const r = this.records.find((r) => r.id === id);
    const m = r ? this.load(id, r.dir) : null;
    if (!r || !m?.main) throw pluginError('NOT_FOUND', '插件没有 main');
    const dataDir = pluginDataPath(this.options.root, id);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    // 只透传清单声明的环境变量；应用自身的密钥等仍留在 Main
    const sourceEnv = this.options.sourceEnv ?? this.options.env;
    const passthrough: NodeJS.ProcessEnv = {};
    for (const key of m.env) if (sourceEnv[key] !== undefined) passthrough[key] = sourceEnv[key];
    const proc = new PluginProcess({
      fork: this.options.fork,
      hostPath: this.options.hostPath,
      env: { ...this.options.env, ...passthrough, ENSO_PLUGIN_DATA: dataDir },
      resident: m.resident,
      init: {
        pluginId: id,
        pluginRoot: pluginPackagePath(this.options.root, id, r.dir),
        main: m.main,
        dataDir,
      },
      handleHostCall: (api, args, invocationId) => this.gate.handle(id, api, args, invocationId),
      onExit: ({ unexpected }) => {
        this.gate.invocations.cancelPlugin(id);
        if (this.dynamic.clear(id)) this.changed();
        if (unexpected) {
          this.recordCrash(id);
          this.scheduleResidentRestart(id);
        }
      },
      onLog: (level, message) => this.appendLog(id, level, message),
    });
    this.processes.set(id, proc);
    return proc;
  }
  private stopProcess(id: string): void {
    this.clearInterceptBreakers(id);
    const timer = this.residentTimers.get(id);
    if (timer) clearTimeout(timer);
    this.residentTimers.delete(id);
    this.gate.invocations.cancelPlugin(id);
    const proc = this.processes.get(id);
    proc?.stop();
    this.processes.delete(id);
    if (proc) {
      const pending = Promise.all([this.stopping.get(id), proc.whenStopped()]).then(
        () => undefined
      );
      this.stopping.set(id, pending);
      void pending.then(() => {
        if (this.stopping.get(id) === pending) this.stopping.delete(id);
      });
    }
    this.dynamic.clear(id);
    for (const [key, lane] of this.observeLanes)
      if (key.startsWith(`${id}\0`)) {
        lane.queue.length = 0;
        this.observeLanes.delete(key);
      }
  }
  private async stopProcessAndWait(id: string): Promise<void> {
    this.stopProcess(id);
    await this.stopping.get(id);
  }
  private emitNotice(notice: ExtensionPluginNotice): void {
    for (const listener of this.noticeListeners) listener(notice);
  }
  private withIdLock<T>(id: string, run: () => Promise<T>): Promise<T> {
    const next = (this.idTails.get(id) ?? Promise.resolve()).then(run, run);
    const tail = next.then(
      () => undefined,
      () => undefined
    );
    this.idTails.set(id, tail);
    void tail.then(() => {
      if (this.idTails.get(id) === tail) this.idTails.delete(id);
    });
    return next;
  }
  private syncBackground(): void {
    this.armSchedules();
    if (this.disposed || !this.background) return;
    for (const { id, manifest } of this.enabled().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (
        !manifest.resident ||
        !manifest.main ||
        this.processes.get(id)?.running ||
        this.starting.has(id) ||
        this.residentTimers.has(id)
      )
        continue;
      const count =
        [...this.processes].filter(
          ([key, proc]) => this.enabledManifest(key)?.resident && proc.running
        ).length + this.starting.size;
      if (count >= 5) {
        this.recordError(id, '常驻插件已达上限（5），未启动');
        continue;
      }
      this.starting.add(id);
      void (async () => {
        try {
          await this.stopping.get(id);
          if (this.disposed || !this.enabledManifest(id)?.resident) return;
          await this.processFor(id).ready();
          this.changed();
        } catch (error) {
          this.appendLog(id, 'error', `常驻插件拉起失败：${String(error)}`);
          this.scheduleResidentRestart(id);
        } finally {
          this.starting.delete(id);
        }
      })();
    }
  }
  private scheduleResidentRestart(id: string): void {
    if (
      this.disposed ||
      !this.background ||
      !this.enabledManifest(id)?.resident ||
      this.residentTimers.has(id)
    )
      return;
    const timer = setTimeout(() => {
      this.residentTimers.delete(id);
      this.syncBackground();
    }, 5000);
    timer.unref?.();
    this.residentTimers.set(id, timer);
  }
  private armSchedules(): void {
    const wanted = new Set<string>();
    if (this.background && !this.disposed)
      for (const { id, manifest } of this.enabled())
        for (const schedule of manifest.contributes.schedules) {
          const key = `${id}\n${schedule.id}`;
          wanted.add(key);
          const old = this.scheduleRuns.get(key);
          if (old?.schedule.intervalSeconds === schedule.intervalSeconds) {
            old.schedule = schedule;
            continue;
          }
          if (old) clearInterval(old.timer);
          const state = {
            running: false,
            schedule,
            timer: setInterval(() => {
              void this.runSchedule(id, state.schedule);
            }, schedule.intervalSeconds * 1000),
          };
          state.timer.unref?.();
          this.scheduleRuns.set(key, state);
        }
    for (const [key, state] of this.scheduleRuns)
      if (!wanted.has(key)) {
        clearInterval(state.timer);
        this.scheduleRuns.delete(key);
      }
  }
  private async runSchedule(
    id: string,
    schedule: ExtensionPluginManifest['contributes']['schedules'][number]
  ): Promise<void> {
    const state = this.scheduleRuns.get(`${id}\n${schedule.id}`);
    if (this.disposed || !state || state.running || !this.enabledManifest(id)) return;
    state.running = true;
    try {
      await this.invoke(
        id,
        'schedule.run',
        { id: schedule.id },
        {
          sessionId: null,
          projectRoot: null,
          gesture: false,
          kind: 'schedule',
          timeoutMs: schedule.timeoutMs ?? 60_000,
        }
      );
      delete state.lastError;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      this.appendLog(id, 'error', `定时任务 ${schedule.id} 失败：${state.lastError}`);
    } finally {
      state.lastRunAt = Date.now();
      state.running = false;
      this.changed();
    }
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
