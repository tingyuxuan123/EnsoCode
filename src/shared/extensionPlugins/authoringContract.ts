import {
  EXTENSION_PLUGIN_PERMISSIONS,
  type ExtensionPluginManifest,
  enginesAllow,
} from './manifest';

export type AuthoringTemplate = 'workspace' | 'sidebar' | 'command' | 'tool';

export const AUTHORING_TEMPLATES: ReadonlyArray<{
  id: AuthoringTemplate;
  label: string;
  description: string;
}> = [
  {
    id: 'workspace',
    label: '独立工作区',
    description: '记忆、知识与管理：左侧入口，完整工作页面。',
  },
  { id: 'sidebar', label: '右侧辅助页', description: '临时查看与轻量辅助，不离开对话。' },
  { id: 'command', label: '快捷命令', description: '无需页面的一次性操作，示例只发送通知。' },
  { id: 'tool', label: '模型工具', description: '无需页面的只读工具，示例只回显输入。' },
];

/** Ordered rules: explicit headless actions take priority over domain words. */
const RECOMMENDATION_RULES: ReadonlyArray<{ pattern: RegExp; template: AuthoringTemplate }> = [
  {
    pattern: /模型.{0,8}工具|工具调用|只读工具|model\s+tool|agent\s+tool|read.only\s+tool/i,
    template: 'tool',
  },
  { pattern: /短命令|快捷命令|命令|\bcommand\b|slash/i, template: 'command' },
  { pattern: /侧栏|侧边|sidebar|临时辅助/i, template: 'sidebar' },
  { pattern: /记忆|知识|管理|笔记|memory|knowledge|manager|notes/i, template: 'workspace' },
  { pattern: /临时|辅助|侧栏|侧边|sidebar|helper|temporary/i, template: 'sidebar' },
];

export function recommendAuthoringTemplate(request: string): AuthoringTemplate {
  return RECOMMENDATION_RULES.find(({ pattern }) => pattern.test(request))?.template ?? 'workspace';
}

const GUIDE = `# 本宿主原生插件能力契约

这是当前代码实现的能力快照，不按版本号推断旧宿主特性。engines.enso >=制作宿主版本只是保守制作 target，不是已证实的最低兼容版本；旧宿主兼容性需另行验证。

main.mjs 导出 activate(enso)，是完整 Node 子进程，不是操作系统沙箱。清单权限只约束宿主 API，不能约束 Node 导入、磁盘或网络。ui.js 与宿主界面同权，只启用可信代码；HTML 页面则是 opaque-origin sandbox iframe，只通过已就绪的 window.enso.call(method,args) 调用本插件 renderer.handle。它没有父窗口 DOM、preload 或任意外部资源访问权。

常用 API：enso.pluginId / dataDir；tools.register；commands.register；renderer.handle；ui.notify；ui.view.open/close/emit；config.get；fs.readText/writeText（项目相对路径及授权范围）；net.fetch（域名白名单）；composer.readDraft/insertText/replaceDraft（版本及编辑状态保护）；events.on；schedules.register；session.list/status/messages/focus/create；agent.run（独立授权的只读代理，可能收费）；browser.invoke；mcp.tools/call。均仍受声明、授权、会话、用户手势及取消约束，API 存在不等于任何上下文都可调用。

支持的 renderer 挂点：message.action、tool.card、block、composer.left、composer.right、thinking.body、message.leaf。不支持 composer.activity / composer.dock 等未接入挂点；清单不能声明或证明脚本使用了哪个挂点，静态预检不执行或解析脚本。

UI 优先使用自包含 HTML 与 window.enso 桥；workspace 对应 views.location=activitybar，sidebar 对应 sidebar。消费宿主 CSS 变量 --panel、--foreground、--primary、--primary-foreground、--border、--muted-foreground、--radius、--font-family-sans、--font-size-base，勿固定浅深配色。错误应可见，未保存草稿不可被刷新或迟到响应覆盖。

插件 JSON 数据只放 enso.dataDir；校验输入和已有文件，坏文件拒绝覆盖，异步串行写临时文件后原子 rename，不删除其他插件数据。不写 settings.json，不嵌入凭证，不向界面或模型暴露任意磁盘路径。工具 schema 必须完整声明参数类型；只读 echo 不调用模型。试用副本可能改 manifest id，代码使用 enso.pluginId，不硬编码身份。

静态预检不执行脚本、不安装、不启用、不发送消息、不收费；通过不是安全或运行成功保证。node --test 是离线行为测试，不代替 Electron、权限及真实模型验收。权威 SDK 见 docs/plugins.md 和本地 enso-plugin.d.ts。
`;

/** hostVersion is descriptive only; features always describe this implementation. */
export function authoringCapabilities(hostVersion: string) {
  return {
    hostVersion,
    features: [
      ...EXTENSION_PLUGIN_PERMISSIONS,
      'commands',
      'renderer.methods',
      'views.sidebar',
      'views.activitybar',
      'views.themeTokens',
      'fileViewers',
      'statusItems',
      'events',
      'schedules',
      'exports',
      'configuration',
      'skills',
      'mcpServers',
      'presets',
      'workflows',
      'agentTypes',
      'themes',
      'dynamic.tools',
      'dynamic.commands',
      'slot.message.action',
      'slot.tool.card',
      'slot.block',
      'slot.composer.left',
      'slot.composer.right',
      'slot.thinking.body',
      'slot.message.leaf',
    ],
    limits: {
      manifestBytes: 256 * 1024,
      viewCallBytes: 64 * 1024,
      viewCallsPerSecond: 10,
      viewEventBytes: 256 * 1024,
      uiUpdatesPerSecond: 20,
      methodTimeoutMs: 120_000,
      toolDefaultTimeoutMs: 60_000,
      toolMaxTimeoutMs: 600_000,
      toolResultBytes: 1024 * 1024,
      fileBytes: 5 * 1024 * 1024,
      configurationItems: 20,
      dynamicTools: 50,
      dynamicCommands: 20,
    },
    guide: GUIDE,
  };
}

export type AuthoringCapabilities = ReturnType<typeof authoringCapabilities>;

/** Receives the native parser's normalized manifest. Never loads plugin scripts.
 * Omitted capabilities means current features, unknown runtime version; Main should pass its version.
 */
export function preflightAuthoringManifest(
  manifest: ExtensionPluginManifest,
  capabilities: AuthoringCapabilities = authoringCapabilities('')
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const available = new Set(capabilities.features);
  const required = new Set<string>(manifest.permissions);
  const c = manifest.contributes;
  if (manifest.renderer || c.methods.length) required.add('renderer.methods');
  if (c.commands.length) required.add('commands');
  for (const view of c.views) required.add(`views.${view.location ?? 'sidebar'}`);
  for (const key of [
    'fileViewers',
    'statusItems',
    'events',
    'schedules',
    'exports',
    'configuration',
    'skills',
    'mcpServers',
    'presets',
    'workflows',
    'agentTypes',
    'themes',
  ] as const) {
    if (c[key].length) required.add(key);
  }
  if (c.dynamic.tools) required.add('dynamic.tools');
  if (c.dynamic.commands) required.add('dynamic.commands');
  for (const feature of required)
    if (!available.has(feature)) errors.push(`宿主未提供能力：${feature}`);
  if (
    manifest.ensoRange &&
    capabilities.hostVersion &&
    !enginesAllow(manifest.ensoRange, capabilities.hostVersion)
  ) {
    errors.push(`engines.enso ${manifest.ensoRange} 不满足当前宿主 ${capabilities.hostVersion}`);
  }
  if (!manifest.ensoRange)
    warnings.push('建议声明 engines.enso 为本次制作宿主 target；不代表已验证旧宿主兼容性。');
  if (manifest.renderer)
    warnings.push(
      '不会解析或执行 renderer；请人工核对挂点，不支持 composer.activity / composer.dock。'
    );
  if (manifest.renderer || c.views.length || c.fileViewers.length) {
    warnings.push(
      'UI 默认跟随宿主主题：使用 --panel / --foreground / --primary / --border 与字体变量；静态预检不检查页面实际样式。'
    );
  }
  return { errors, warnings };
}
