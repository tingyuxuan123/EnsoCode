import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  type ExtensionPluginManifest,
  type ExtensionPluginPermission,
  isPluginRelativePath,
} from '@shared/extensionPlugins/manifest';
import { hasPluginMcpGrant, isPluginMcpServerName } from '@shared/extensionPlugins/mcpGrant';
import type { PluginHostApi } from '@shared/extensionPlugins/protocol';
import { pluginError } from './process';
export const GESTURE_TTL_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
export type ComposerOp = 'readDraft' | 'insertText' | 'replaceDraft';
export interface ComposerTarget {
  sessionId: string;
  origin: number | null;
}
export interface McpTarget {
  sessionId: string | null;
  projectRoot: string | null;
}
export interface McpToolInfo {
  server: string;
  name: string;
  description: string;
}
export interface PluginInvocationPolicy {
  allowWrite: boolean;
  allowMcpCall: boolean;
}
export interface GateDeps {
  manifest(pluginId: string): ExtensionPluginManifest | null;
  /** Production transport MUST validate public DNS, pin the connection, and stream bounded bodies. */
  fetch(url: string, init: RequestInit): Promise<Response>;
  notify(title: string, body: string): boolean;
  composer(
    target: ComposerTarget,
    op: ComposerOp,
    payload: Record<string, unknown>
  ): Promise<unknown>;
  sessionMessages(sessionId: string): Promise<unknown>;
  config(pluginId: string): Record<string, string>;
  mcpTools(target: McpTarget, signal: AbortSignal): Promise<McpToolInfo[]>;
  /** Bridge must approve the actual MCP tool on the exact live worker generation. */
  mcpCall(
    target: McpTarget,
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ content: string; isError: boolean }>;
  invocationPolicy(target: McpTarget): Promise<PluginInvocationPolicy>;
  now(): number;
}
export interface InvocationInit {
  pluginId: string;
  sessionId: string | null;
  projectRoot: string | null;
  gesture: boolean;
  origin?: number | null;
}
interface Invocation extends InvocationInit {
  createdAt: number;
  cancelled: boolean;
  controller: AbortController;
}
export class InvocationTable {
  private readonly table = new Map<string, Invocation>();
  constructor(private readonly now: () => number) {}
  get size(): number {
    return this.table.size;
  }
  create(init: InvocationInit): string {
    const id = randomUUID();
    this.table.set(id, {
      ...init,
      createdAt: this.now(),
      cancelled: false,
      controller: new AbortController(),
    });
    return id;
  }
  get(id: string | undefined): Invocation | undefined {
    return id ? this.table.get(id) : undefined;
  }
  cancel(id: string): void {
    const e = this.table.get(id);
    if (e) {
      e.cancelled = true;
      e.controller.abort();
    }
  }
  /** No dangling authority after the owning call settles. */
  finish(id: string): void {
    this.cancel(id);
    this.table.delete(id);
  }
  cancelPlugin(pluginId: string): void {
    for (const [id, e] of this.table) if (e.pluginId === pluginId) this.finish(id);
  }
  dispose(): void {
    for (const id of this.table.keys()) this.finish(id);
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const within = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const covered = (path: string, scopes: string[]) =>
  scopes.some((s) => s === '.' || path === s || path.startsWith(`${s}/`));
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
export class PluginHostGate {
  readonly invocations: InvocationTable;
  constructor(private readonly deps: GateDeps) {
    this.invocations = new InvocationTable(deps.now);
  }
  dispose(): void {
    this.invocations.dispose();
  }
  async handle(
    pluginId: string,
    api: PluginHostApi,
    args: unknown,
    invocationId: string | undefined
  ): Promise<unknown> {
    const manifest = this.deps.manifest(pluginId);
    if (!manifest) throw pluginError('PLUGIN_DISABLED', '插件未启用');
    const a = record(args) ? args : {};
    const permit = (p: ExtensionPluginPermission) => {
      if (!manifest.permissions.includes(p))
        throw pluginError('PERMISSION_DENIED', `插件未获授权：${p}`);
    };
    const invocation = () => {
      const inv = this.invocations.get(invocationId);
      if (!inv || inv.pluginId !== pluginId)
        throw pluginError('NO_INVOCATION', '此接口只能在宿主发起的调用内使用');
      if (inv.cancelled) throw pluginError('ABORTED', '调用已取消');
      return inv;
    };
    switch (api) {
      case 'fs.readText': {
        permit('fs.read');
        const inv = invocation();
        const target = await this.projectPath(inv, a.path, manifest.fs.read, false);
        const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile()) throw pluginError('INVALID_ARGS', '不是文件');
          if (info.size > MAX_BYTES) throw pluginError('TOO_LARGE', '文件过大');
          const buffer = Buffer.alloc(MAX_BYTES + 1);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead > MAX_BYTES) throw pluginError('TOO_LARGE', '文件过大');
          return buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          await file.close();
        }
      }
      case 'fs.writeText': {
        permit('fs.write');
        const inv = invocation();
        if (typeof a.text !== 'string' || bytes(a.text) > MAX_BYTES)
          throw pluginError('INVALID_ARGS', 'text 不合法或过大');
        await this.assertMutation(inv, 'allowWrite');
        const target = await this.projectPath(inv, a.path, manifest.fs.write, true);
        await this.assertMutation(inv, 'allowWrite');
        if (inv.cancelled) throw pluginError('ABORTED', '调用已取消');
        const file = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
          0o600
        );
        try {
          const info = await file.stat();
          if (!info.isFile() || info.nlink !== 1)
            throw pluginError('PERMISSION_DENIED', '不能写入特殊文件或硬链接');
          await file.truncate(0);
          await file.writeFile(a.text, 'utf8');
        } finally {
          await file.close();
        }
        return null;
      }
      case 'net.fetch':
        permit('net.fetch');
        return this.fetch(manifest, a, invocation().controller.signal);
      case 'ui.notify': {
        permit('ui.notify');
        if (typeof a.title !== 'string' || !a.title || a.title.length > 200)
          throw pluginError('INVALID_ARGS', 'title 不合法');
        if (!this.deps.notify(a.title, typeof a.body === 'string' ? a.body.slice(0, 1000) : ''))
          throw pluginError('UNSUPPORTED', '系统通知不可用');
        return null;
      }
      case 'composer.readDraft':
      case 'composer.insertText':
      case 'composer.replaceDraft': {
        permit('composer.draft');
        const inv = invocation();
        if (!inv.gesture || this.deps.now() - inv.createdAt > GESTURE_TTL_MS)
          throw pluginError('GESTURE_REQUIRED', '只能在用户操作触发的调用里读写草稿');
        if (!inv.sessionId) throw pluginError('NO_SESSION', '调用不属于会话');
        const op = api.slice('composer.'.length) as ComposerOp;
        if (op !== 'readDraft' && (typeof a.text !== 'string' || bytes(a.text) > 32768))
          throw pluginError('INVALID_ARGS', 'text 不合法或超过 32KB');
        return this.deps.composer({ sessionId: inv.sessionId, origin: inv.origin ?? null }, op, a);
      }
      case 'session.messages': {
        permit('session.read');
        const inv = invocation();
        if (!inv.sessionId) throw pluginError('NO_SESSION', '调用不属于会话');
        return this.deps.sessionMessages(inv.sessionId);
      }
      case 'config.get':
        return this.deps.config(pluginId);
      case 'mcp.tools': {
        permit('mcp.call');
        const inv = invocation();
        const tools = await this.deps.mcpTools(
          { sessionId: inv.sessionId, projectRoot: inv.projectRoot },
          inv.controller.signal
        );
        return tools.filter((t) => hasPluginMcpGrant(manifest.mcp.tools, t.server, t.name));
      }
      case 'mcp.call': {
        permit('mcp.call');
        if (!isPluginMcpServerName(a.server)) throw pluginError('INVALID_ARGS', 'server 不合法');
        if (typeof a.tool !== 'string' || !hasPluginMcpGrant(manifest.mcp.tools, a.server, a.tool))
          throw pluginError('PERMISSION_DENIED', '清单没有声明此 server/tool MCP 工具');
        const inv = invocation();
        const params = a.args ?? {};
        if (!record(params) || bytes(JSON.stringify(params)) > 65536)
          throw pluginError('INVALID_ARGS', 'MCP args 必须是不超过 64KB 的对象');
        await this.assertMutation(inv, 'allowMcpCall');
        if (inv.cancelled) throw pluginError('ABORTED', '调用已取消');
        return this.deps.mcpCall(
          { sessionId: inv.sessionId, projectRoot: inv.projectRoot },
          a.server,
          a.tool,
          params,
          inv.controller.signal
        );
      }
    }
  }
  private async assertMutation(
    inv: Invocation,
    capability: keyof PluginInvocationPolicy
  ): Promise<void> {
    const policy = await this.deps.invocationPolicy({
      sessionId: inv.sessionId,
      projectRoot: inv.projectRoot,
    });
    if (policy[capability] !== true)
      throw pluginError('PERMISSION_DENIED', '当前会话状态不允许插件修改文件或调用 MCP');
  }
  private async projectPath(
    inv: Invocation,
    path: unknown,
    scopes: string[],
    write: boolean
  ): Promise<string> {
    if (!inv.projectRoot) throw pluginError('NO_PROJECT', '当前会话没有本机项目目录');
    if (!isPluginRelativePath(path) || path === '.')
      throw pluginError('INVALID_ARGS', 'path 必须是项目内相对路径');
    const root = await realpath(inv.projectRoot);
    const target = resolve(root, path);
    const rel = relative(root, target).split('\\').join('/');
    if (!within(root, target) || !covered(rel, scopes))
      throw pluginError('PERMISSION_DENIED', '路径不在授权范围');
    let canonical: string;
    if (write) {
      const parent = await realpath(dirname(target));
      const existing = await lstat(target).catch(() => null);
      if (existing?.isSymbolicLink()) throw pluginError('PERMISSION_DENIED', '不能写入符号链接');
      canonical = resolve(parent, relative(dirname(target), target));
    } else canonical = await realpath(target);
    if (
      !within(root, canonical) ||
      !covered(relative(root, canonical).split('\\').join('/'), scopes)
    )
      throw pluginError('PERMISSION_DENIED', '路径逃出授权范围');
    return canonical;
  }
  private async fetch(
    manifest: ExtensionPluginManifest,
    a: Record<string, unknown>,
    signal: AbortSignal
  ) {
    const init = record(a.init) ? a.init : {};
    const method = typeof init.method === 'string' ? init.method.toUpperCase() : 'GET';
    const headers: Record<string, string> = {};
    if (record(init.headers))
      for (const [k, v] of Object.entries(init.headers))
        if (
          typeof v === 'string' &&
          !['host', 'authorization', 'cookie', 'proxy-authorization'].includes(k.toLowerCase())
        )
          headers[k] = v;
    const body = typeof init.body === 'string' ? init.body : undefined;
    if (body && bytes(body) > MAX_BYTES) throw pluginError('TOO_LARGE', '请求过大');
    let url = typeof a.url === 'string' ? a.url : '';
    for (let hop = 0; hop <= 5; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw pluginError('INVALID_ARGS', 'url 不合法');
      }
      if (
        !['https:', 'http:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        !manifest.net.domains.includes(parsed.hostname)
      )
        throw pluginError('PERMISSION_DENIED', '协议或域名未授权');
      const res = await this.deps.fetch(parsed.href, {
        method,
        headers,
        ...(body !== undefined && hop === 0 ? { body } : {}),
        redirect: 'manual',
        signal,
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        url = new URL(location, parsed).href;
        continue;
      }
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
        await res.body?.cancel();
        throw pluginError('TOO_LARGE', '响应过大');
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        if (reader)
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_BYTES) throw pluginError('TOO_LARGE', '响应过大');
            chunks.push(value);
          }
      } finally {
        await reader?.cancel().catch(() => {});
      }
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body: Buffer.concat(chunks).toString('utf8'),
      };
    }
    throw pluginError('TOO_MANY_REDIRECTS', '重定向次数过多');
  }
}
