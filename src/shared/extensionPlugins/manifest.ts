import { parsePluginMcpGrant } from './mcpGrant';
import { pluginToolName } from './toolName';
export const EXTENSION_PLUGIN_PERMISSIONS = [
  'agent.tool',
  'ui.slot',
  'ui.view',
  'ui.notify',
  'composer.draft',
  'fs.read',
  'fs.write',
  'net.fetch',
  'session.read',
  'mcp.server',
  'mcp.call',
] as const;
export type ExtensionPluginPermission = (typeof EXTENSION_PLUGIN_PERMISSIONS)[number];
export const PLUGIN_TRIGGER_SYMBOLS = ['#'] as const;
export type PluginTriggerSymbol = '#';
export interface PluginAgentToolContrib {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface PluginCommandContrib {
  id: string;
  title: string;
}
export interface PluginViewContrib {
  id: string;
  title: string;
  entry: string;
}
export interface PluginTriggerContrib {
  symbol: PluginTriggerSymbol;
  name: string;
}
export interface PluginMcpContrib {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}
export interface PluginMethodContrib {
  name: string;
  timeoutMs: number;
}
export interface PluginConfigContrib {
  key: string;
  title: string;
  description: string;
  secret: boolean;
}
export interface PluginPresetContrib {
  id: string;
  name: string;
  skills: string[];
  mcpServers: string[];
  instruction?: string;
  systemPrompt?: string;
}
export interface ExtensionPluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  ensoRange?: string;
  main?: string;
  renderer?: string;
  permissions: ExtensionPluginPermission[];
  fs: { read: string[]; write: string[] };
  net: { domains: string[] };
  mcp: { tools: string[] };
  contributes: {
    agentTools: PluginAgentToolContrib[];
    commands: PluginCommandContrib[];
    views: PluginViewContrib[];
    triggers: PluginTriggerContrib[];
    skills: string[];
    mcpServers: PluginMcpContrib[];
    methods: PluginMethodContrib[];
    configuration: PluginConfigContrib[];
    presets: PluginPresetContrib[];
  };
}
export type ManifestParseResult =
  | { ok: true; manifest: ExtensionPluginManifest; warnings: string[] }
  | { ok: false; errors: string[] };
export const MAX_METHOD_TIMEOUT_MS = 120_000;
const ID = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const LOCAL = /^[a-z][a-z0-9-]{0,31}$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOP = new Set([
  'schemaVersion',
  'id',
  'name',
  'version',
  'description',
  'engines',
  'main',
  'renderer',
  'permissions',
  'fs',
  'net',
  'mcp',
  'contributes',
]);
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function isPluginRelativePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 256 &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.startsWith('/') &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split('/').every((s) => s !== '..')
  );
}
export function parseExtensionPluginManifest(
  raw: unknown,
  hostVersion: string
): ManifestParseResult {
  if (!record(raw)) return { ok: false, errors: ['清单必须是 JSON 对象'] };
  const errors: string[] = [];
  const warnings = Object.keys(raw)
    .filter((k) => !TOP.has(k))
    .map((k) => `忽略未知字段 ${k}`);
  if (raw.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!text(raw.id, 40) || !ID.test(raw.id)) errors.push('id 不合法');
  if (!text(raw.name, 60)) errors.push('name 不合法');
  if (!text(raw.version, 40)) errors.push('version 不合法');
  if (raw.description !== undefined && typeof raw.description !== 'string')
    errors.push('description 不合法');
  let ensoRange: string | undefined;
  if (raw.engines !== undefined) {
    const range = record(raw.engines) ? raw.engines.enso : undefined;
    const match = typeof range === 'string' ? /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range) : null;
    if (!match) errors.push('engines.enso 只支持 >=x.y.z');
    else {
      ensoRange = String(range);
      const host = hostVersion.split(/[.-]/).slice(0, 3).map(Number);
      const required = match.slice(1).map(Number);
      const diff = host.map((v, i) => v - required[i]).find((d) => d !== 0) ?? 0;
      if (host.some((v) => !Number.isFinite(v)) || diff < 0) errors.push(`需要 Enso ${ensoRange}`);
    }
  }
  const path = (value: unknown, label: string): string | undefined => {
    if (value === undefined) return undefined;
    if (!isPluginRelativePath(value) || value === '.') {
      errors.push(`${label} 路径不合法`);
      return undefined;
    }
    return value;
  };
  const main = path(raw.main, 'main');
  const renderer = path(raw.renderer, 'renderer');
  const strings = (value: unknown, label: string, check: (v: unknown) => boolean): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(check)) {
      errors.push(`${label} 不合法`);
      return [];
    }
    return [...new Set(value as string[])];
  };
  if (!Array.isArray(raw.permissions)) errors.push('permissions 必须是数组');
  const permissions = strings(raw.permissions, 'permissions', (v) =>
    (EXTENSION_PLUGIN_PERMISSIONS as readonly unknown[]).includes(v)
  ) as ExtensionPluginPermission[];
  for (const key of ['fs', 'net', 'mcp', 'contributes'])
    if (raw[key] !== undefined && !record(raw[key])) errors.push(`${key} 不合法`);
  const f = record(raw.fs) ? raw.fs : {};
  const n = record(raw.net) ? raw.net : {};
  const m = record(raw.mcp) ? raw.mcp : {};
  const c = record(raw.contributes) ? raw.contributes : {};
  const fs = {
    read: strings(f.read, 'fs.read', isPluginRelativePath),
    write: strings(f.write, 'fs.write', isPluginRelativePath),
  };
  const net = {
    domains: strings(n.domains, 'net.domains', (d) => typeof d === 'string' && DOMAIN.test(d)),
  };
  const mcp = {
    tools: strings(m.tools, 'mcp.tools', (t) => parsePluginMcpGrant(t) !== null),
  };
  const list = (key: string): Record<string, unknown>[] => {
    if (c[key] === undefined) return [];
    if (!Array.isArray(c[key]) || !c[key].every(record)) {
      errors.push(`contributes.${key} 必须是对象数组`);
      return [];
    }
    return c[key];
  };
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) errors.push(`${label} 重复`);
  };
  const agentTools: PluginAgentToolContrib[] = [];
  for (const t of list('agentTools')) {
    if (
      typeof t.name !== 'string' ||
      !/^[a-z][a-z0-9_]*$/.test(t.name) ||
      t.name.includes('__') ||
      pluginToolName(String(raw.id), t.name).length > 64 ||
      !text(t.description, 1024) ||
      !record(t.parameters) ||
      t.parameters.type !== 'object'
    )
      errors.push('工具名、description 或 parameters 不合法');
    else agentTools.push({ name: t.name, description: t.description, parameters: t.parameters });
  }
  const commands: PluginCommandContrib[] = [];
  for (const cmd of list('commands')) {
    if (typeof cmd.id !== 'string' || !LOCAL.test(cmd.id) || !text(cmd.title, 60))
      errors.push('命令不合法');
    else commands.push({ id: cmd.id, title: cmd.title });
  }
  const views: PluginViewContrib[] = [];
  for (const v of list('views')) {
    if (
      typeof v.id !== 'string' ||
      !LOCAL.test(v.id) ||
      !text(v.title, 40) ||
      !isPluginRelativePath(v.entry) ||
      !v.entry.endsWith('.html')
    )
      errors.push('侧栏页面不合法');
    else views.push({ id: v.id, title: v.title, entry: v.entry });
  }
  const triggers: PluginTriggerContrib[] = [];
  for (const t of list('triggers')) {
    if (t.symbol !== '#' || typeof t.name !== 'string' || !LOCAL.test(t.name))
      errors.push('补全来源不合法');
    else triggers.push({ symbol: '#', name: t.name });
  }
  const skills = strings(
    c.skills,
    'contributes.skills',
    (p) => isPluginRelativePath(p) && p !== '.'
  );
  const mcpServers: PluginMcpContrib[] = [];
  for (const s of list('mcpServers')) {
    const args = s.args ?? [];
    const env = s.env ?? {};
    if (
      typeof s.name !== 'string' ||
      !LOCAL.test(s.name) ||
      !text(s.command, 512) ||
      !Array.isArray(args) ||
      !args.every((a) => typeof a === 'string') ||
      !record(env) ||
      !Object.values(env).every((v) => typeof v === 'string')
    )
      errors.push('MCP 服务不合法');
    else
      mcpServers.push({
        name: s.name,
        command: s.command,
        args,
        env: env as Record<string, string>,
      });
  }
  const presets: PluginPresetContrib[] = [];
  const presetRaw = list('presets');
  if (presetRaw.length > 20) errors.push('预设最多 20 个');
  for (const p of presetRaw) {
    if (typeof p.id !== 'string' || !LOCAL.test(p.id) || !text(p.name, 60)) {
      errors.push('预设不合法');
      continue;
    }
    const ps = strings(
      p.skills,
      `预设 ${p.id} 的 skills`,
      (v) => typeof v === 'string' && skills.includes(v)
    );
    const pm = strings(
      p.mcpServers,
      `预设 ${p.id} 的 mcpServers`,
      (v) => typeof v === 'string' && mcpServers.some((s) => s.name === v)
    );
    const preset: PluginPresetContrib = {
      id: p.id,
      name: p.name.trim(),
      skills: ps,
      mcpServers: pm,
    };
    for (const key of ['systemPromptTail', 'boostPrompt', 'refusalRetry', 'refusalRetryPrompt'])
      if (key in p) errors.push(`预设 ${p.id} 不支持字段 ${key}`);
    for (const key of ['instruction', 'systemPrompt'] as const) {
      const val = path(p[key], `预设 ${p.id} 的 ${key}`);
      if (val) preset[key] = val;
    }
    presets.push(preset);
  }
  const methods: PluginMethodContrib[] = [];
  for (const m of list('methods')) {
    if (
      typeof m.name !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(m.name) ||
      !Number.isInteger(m.timeoutMs) ||
      Number(m.timeoutMs) < 1000 ||
      Number(m.timeoutMs) > MAX_METHOD_TIMEOUT_MS
    )
      errors.push('方法超时声明不合法');
    else methods.push({ name: m.name, timeoutMs: Number(m.timeoutMs) });
  }
  const configuration: PluginConfigContrib[] = [];
  const configs = list('configuration');
  if (configs.length > 20) errors.push('配置项最多 20 项');
  for (const conf of configs) {
    if (
      typeof conf.key !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(conf.key) ||
      !text(conf.title, 60) ||
      (conf.description !== undefined && !text(conf.description, 500)) ||
      (conf.secret !== undefined && typeof conf.secret !== 'boolean')
    )
      errors.push('配置项不合法');
    else
      configuration.push({
        key: conf.key,
        title: conf.title,
        description: typeof conf.description === 'string' ? conf.description : '',
        secret: conf.secret === true,
      });
  }
  for (const [label, values] of [
    ['工具', agentTools.map((t) => t.name)],
    ['命令', commands.map((t) => t.id)],
    ['侧栏页面', views.map((t) => t.id)],
    ['补全来源', triggers.map((t) => t.name)],
    ['MCP 服务', mcpServers.map((t) => t.name)],
    ['预设', presets.map((t) => t.id)],
    ['方法', methods.map((t) => t.name)],
    ['配置项', configuration.map((t) => t.key)],
  ] as const)
    unique(values, label);
  const need = (present: boolean, permission: ExtensionPluginPermission) => {
    if (present && !permissions.includes(permission)) errors.push(`需要权限 ${permission}`);
  };
  need(agentTools.length > 0, 'agent.tool');
  need(!!renderer || triggers.length > 0, 'ui.slot');
  need(views.length > 0, 'ui.view');
  need(mcpServers.length > 0, 'mcp.server');
  need(fs.read.length > 0, 'fs.read');
  need(fs.write.length > 0, 'fs.write');
  need(net.domains.length > 0, 'net.fetch');
  need(mcp.tools.length > 0, 'mcp.call');
  if (permissions.includes('mcp.call') && !mcp.tools.length)
    errors.push('mcp.call 需要声明 mcp.tools');
  if (
    !main &&
    (agentTools.length ||
      commands.length ||
      triggers.length ||
      methods.length ||
      configuration.length)
  )
    errors.push('声明工具、命令、补全、方法或配置时必须提供 main');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    manifest: {
      schemaVersion: 1,
      id: String(raw.id),
      name: String(raw.name).trim(),
      version: String(raw.version),
      description: typeof raw.description === 'string' ? raw.description : '',
      ...(ensoRange ? { ensoRange } : {}),
      ...(main ? { main } : {}),
      ...(renderer ? { renderer } : {}),
      permissions,
      fs,
      net,
      mcp,
      contributes: {
        agentTools,
        commands,
        views,
        triggers,
        skills,
        mcpServers,
        presets,
        methods,
        configuration,
      },
    },
  };
}
