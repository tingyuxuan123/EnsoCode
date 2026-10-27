// 仅供设计预览的演示数据，非真实运行记录。
export const taskTitle = '统一工作台布局与侧栏样式';
export const projectName = 'EnsoCode';
export const projects = [
  { name: 'EnsoCode', local: true, sessions: [taskTitle, '优化文件搜索体验', '排查浏览器预览问题'] },
  { name: 'phone-companion', local: true, sessions: ['调整手机审批页面'] },
  { name: 'design-system', local: true, sessions: [] },
  { name: 'relay-service', local: false, sessions: [] },
];
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
export const agents = [
  { name: '主会话', icon: 'icon-[lucide--messages-square]', status: '等待你的下一步' },
  { name: '界面实现', icon: 'icon-[lucide--bot]', status: '已完成样式调整' },
  { name: '回归检查', icon: 'icon-[lucide--shield-check]', status: '已完成界面检查' },
];
export const models = ['Claude Sonnet 4.5', 'GPT-5 Codex', 'Gemini 2.5 Pro'];
export const settingsNav = [
  { group: '工作台', items: [['通用设置', 'icon-[lucide--settings-2]'], ['外观', 'icon-[lucide--palette]'], ['快捷键', 'icon-[lucide--keyboard]']] },
  { group: 'Agent', items: [['模型服务', 'icon-[lucide--radio]'], ['运行时预设', 'icon-[lucide--sliders-horizontal]'], ['技能与 MCP', 'icon-[lucide--blocks]'], ['审批与安全', 'icon-[lucide--shield-check]']] },
  { group: '连接与数据', items: [['远程节点', 'icon-[lucide--monitor]'], ['手机伴侣', 'icon-[lucide--smartphone]'], ['导入与存储', 'icon-[lucide--database]']] },
];
