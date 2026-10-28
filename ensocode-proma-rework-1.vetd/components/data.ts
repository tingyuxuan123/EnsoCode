// 仅供设计预览的演示数据，非真实运行记录。标签取自 src/shared/i18n.ts 的中文字典。
export const taskTitle = '统一工作台布局与侧栏样式';
export const projectName = 'EnsoCode';

export type Dot = 'running' | 'waiting' | 'failed' | 'unread' | 'idle';
export type Session = { id: string; title: string; time: string; dot: Dot; worktree?: string; pinned?: boolean; forkedFrom?: string; titlePending?: boolean };
export type Project = { id: string; name: string; local: boolean; host?: string; group: string; pinned?: boolean; sessions: Session[] };

export const groups = [
  { id: 'daily', name: '日常开发', color: 'bg-primary' },
  { id: 'remote', name: '远程服务', color: 'bg-warning' },
];

export const projects: Project[] = [
  {
    id: 'enso', name: 'EnsoCode', local: true, group: 'daily', pinned: true, sessions: [
      { id: 's1', title: taskTitle, time: '2 分钟', dot: 'running' },
      { id: 's2', title: '优化文件搜索体验', time: '1 小时', dot: 'waiting', worktree: 'enso/file-search' },
      { id: 's3', title: '排查浏览器预览问题', time: '昨天', dot: 'unread', pinned: true },
      { id: 's4', title: '补充状态栏字段排序', time: '3 天', dot: 'idle', forkedFrom: '优化文件搜索体验' },
    ],
  },
  { id: 'phone', name: 'phone-companion', local: true, group: 'daily', sessions: [{ id: 's5', title: '调整手机审批页面', time: '2 天', dot: 'failed' }] },
  { id: 'design', name: 'design-system', local: true, group: '', sessions: [] },
  { id: 'relay', name: 'relay-service', local: false, host: '生产服务器', group: 'remote', sessions: [{ id: 's6', title: '中继握手超时排查', time: '5 天', dot: 'idle' }] },
];
export const activeSessionIds = ['s1', 's2'];
export const archivedCount = 12;

export const changes = [
  { name: 'App.tsx', folder: 'src/renderer', added: 24, removed: 18, type: 'tsx' },
  { name: 'Sidebar.tsx', folder: 'src/renderer/components/chat', added: 32, removed: 21, type: 'tsx' },
  { name: 'globals.css', folder: 'src/renderer/styles', added: 18, removed: 8, type: 'css' },
];
export const added = changes.reduce((n, file) => n + file.added, 0);
export const removed = changes.reduce((n, file) => n + file.removed, 0);
export const files = [
  { name: 'src', level: 0, folder: true },
  { name: 'agent', level: 1, folder: true },
  { name: 'main', level: 1, folder: true },
  { name: 'preload', level: 1, folder: true },
  { name: 'renderer', level: 1, folder: true },
  { name: 'components', level: 2, folder: true },
  { name: 'chat', level: 3, folder: true },
  { name: 'Sidebar.tsx', level: 4, modified: true },
  { name: 'Composer.tsx', level: 4 },
  { name: 'styles', level: 2, folder: true },
  { name: 'globals.css', level: 3, modified: true },
  { name: 'App.tsx', level: 2, modified: true },
  { name: 'shared', level: 1, folder: true },
  { name: 'docs', level: 0, folder: true },
  { name: 'package.json', level: 0 },
  { name: 'AGENTS.md', level: 0 },
];

/** 长期协作者（coworker）：主会话顶部页签；一次性子代理不在页签里，在任务栏「后台 Agent」 */
export const coworkers = [
  { id: 'cw1', name: '界面实现', tone: 'idle' as const, status: '协作者待命' },
  { id: 'cw2', name: '回归检查', tone: 'attention' as const, status: '需要审批' },
];
/** 兼容旧引用 */
export const agents = [
  { name: '主会话', icon: 'icon-[lucide--messages-square]', status: '等待你的下一步' },
  { name: '界面实现', icon: 'icon-[lucide--bot]', status: '协作者待命' },
  { name: '回归检查', icon: 'icon-[lucide--bot]', status: '需要审批' },
];

/** 模型选择器：厂商 → 服务商条目 → 模型（级联），另有虚拟模型 */
export const vendors = [
  { id: 'anthropic', label: 'Anthropic', entries: [{ id: 'claude-max', primary: 'Claude 订阅', secondary: 'dev@example.com', plan: 'Max', usage: '5 小时窗口 42%', models: ['Claude Sonnet 4.5', 'Claude Opus 4.1', 'Claude Haiku 4.5'] }] },
  { id: 'openai', label: 'OpenAI', entries: [
    { id: 'chatgpt-pool', primary: 'ChatGPT 自动接替池', secondary: '3 个账号', plan: 'Pro', usage: '', models: ['GPT-5 Codex', 'GPT-5'] },
    { id: 'openai-api', primary: 'OpenAI API', secondary: 'API Key', plan: '', usage: '', models: ['GPT-5', 'GPT-5 mini'] },
  ] },
  { id: 'google', label: 'Google', entries: [{ id: 'gemini-api', primary: 'Gemini API', secondary: 'API Key', plan: '', usage: '', models: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash'] }] },
  { id: 'custom', label: '自定义', entries: [{ id: 'deepseek', primary: 'DeepSeek', secondary: 'OpenAI Completions', plan: '', usage: '', models: ['deepseek-chat', 'deepseek-reasoner'] }] },
];
export const virtualModels = ['日常编码（自动分档）', '长上下文回退'];
export const models = ['Claude Sonnet 4.5', 'GPT-5 Codex', 'Gemini 2.5 Pro'];
export const thinkingLevels = ['关', '低', '中', '高', '最高'];

/** 四档审批（ApprovalModePicker），助手代审需在设置中选好代审模型 */
export const approvalModes = [
  { id: 'supervised', label: '全程审批', desc: '每条命令与文件改动都需确认', icon: 'icon-[lucide--shield-check]' },
  { id: 'auto-edits', label: '自动接受编辑', desc: '文件编辑直接执行,命令与 MCP 仍需确认', icon: 'icon-[lucide--shield]' },
  { id: 'full', label: '完全放行', desc: '所有操作不经确认直接执行', icon: 'icon-[lucide--shield-off]' },
  { id: 'assistant', label: '助手代审', desc: '由设置中的模型先审每一步操作', icon: 'icon-[lucide--sparkles]' },
];

export const presets = [
  { id: 'default', name: '全局', desc: '跟随技能 / MCP / 指令文件页的启用开关', locked: true },
  { id: 'reviewer', name: '代码审查', desc: '2 个技能 · 1 个 MCP · 1 份指令' },
  { id: 'frontend', name: '前端重构', desc: '4 个技能 · 2 个 MCP · 1 份指令' },
];

/** 21 个设置类别，顺序与 SettingsContent.tsx 一致；sub 为 Bot 子页，gate 为显隐条件 */
export const settingsCategories = [
  { id: 'general', label: '通用', icon: 'icon-[lucide--settings]' },
  { id: 'shortcuts', label: '快捷键', icon: 'icon-[lucide--keyboard]' },
  { id: 'voice', label: '语音输入', icon: 'icon-[lucide--mic]' },
  { id: 'appearance', label: '外观', icon: 'icon-[lucide--palette]' },
  { id: 'providers', label: '模型中心', icon: 'icon-[lucide--server]' },
  { id: 'presets', label: '预设', icon: 'icon-[lucide--layers]' },
  { id: 'agents', label: '子代理类型', icon: 'icon-[lucide--bot]' },
  { id: 'tools', label: '内置工具', icon: 'icon-[lucide--wrench]' },
  { id: 'workflows', label: '工作流', icon: 'icon-[lucide--workflow]', gate: '内置工具「工作流」开启时显示' },
  { id: 'memory', label: '记忆', icon: 'icon-[lucide--brain]', gate: '内置工具「记忆」开启时显示' },
  { id: 'skills', label: '技能', icon: 'icon-[lucide--sparkles]' },
  { id: 'plugins', label: '插件', icon: 'icon-[lucide--puzzle]' },
  { id: 'mcp', label: 'MCP 服务器', icon: 'icon-[lucide--plug]' },
  { id: 'instructions', label: '指令文件', icon: 'icon-[lucide--file-text]' },
  { id: 'phone', label: '设备', icon: 'icon-[lucide--smartphone]' },
  { id: 'ssh', label: 'SSH', icon: 'icon-[lucide--terminal]' },
  { id: 'usage', label: '用量', icon: 'icon-[lucide--chart-column]' },
  { id: 'resources', label: '资源', icon: 'icon-[lucide--gauge]' },
  { id: 'experimental', label: '实验功能', icon: 'icon-[lucide--flask-conical]' },
  { id: 'bots', label: 'Bot 模式', icon: 'icon-[lucide--bot-message-square]', sub: true, gate: '实验功能中开启 Bot 模式后显示' },
  { id: 'botTemplates', label: 'Bot 模板', icon: 'icon-[lucide--layout-template]', sub: true, gate: '实验功能中开启 Bot 模式后显示' },
];
/** 兼容旧引用 */
export const settingsNav = [{ group: '设置', items: settingsCategories.map((c) => [c.label, c.icon]) }];

/** 右侧停靠面板可新建的标签类型（SidePanel.tsx） */
export const sideTabKinds = [
  { id: 'files', label: '文件', icon: 'icon-[lucide--folder-open]' },
  { id: 'changes', label: '改动', icon: 'icon-[lucide--git-compare]' },
  { id: 'terminal', label: '终端', icon: 'icon-[lucide--square-terminal]' },
  { id: 'browser', label: '浏览器', icon: 'icon-[lucide--globe]' },
  { id: 'btw', label: '旁路', icon: 'icon-[lucide--message-circle]' },
  { id: 'agents', label: '代理', icon: 'icon-[lucide--bot]' },
  { id: 'workflow', label: '工作流', icon: 'icon-[lucide--workflow]' },
];
