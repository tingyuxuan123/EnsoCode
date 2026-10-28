// 文件面板演示数据：工作区树与文件内容（示例，非真实读取）
export type TreeNode = { rel: string; name: string; dir?: boolean; children?: TreeNode[]; status?: 'M' | 'A' | 'U' };

export const tree: TreeNode[] = [
  { rel: 'docs', name: 'docs', dir: true, children: [
    { rel: 'docs/engineering-guidelines.md', name: 'engineering-guidelines.md' },
    { rel: 'docs/readme', name: 'readme', dir: true, children: [
      { rel: 'docs/readme/chat.jpg', name: 'chat.jpg' },
      { rel: 'docs/readme/split-workbench.png', name: 'split-workbench.png' },
    ] },
  ] },
  { rel: 'src', name: 'src', dir: true, children: [
    { rel: 'src/main', name: 'main', dir: true, children: [{ rel: 'src/main/index.ts', name: 'index.ts' }] },
    { rel: 'src/renderer', name: 'renderer', dir: true, children: [
      { rel: 'src/renderer/components', name: 'components', dir: true, children: [
        { rel: 'src/renderer/components/chat', name: 'chat', dir: true, children: [
          { rel: 'src/renderer/components/chat/Composer.tsx', name: 'Composer.tsx' },
          { rel: 'src/renderer/components/chat/Sidebar.tsx', name: 'Sidebar.tsx', status: 'M' },
          { rel: 'src/renderer/components/chat/GroupChips.tsx', name: 'GroupChips.tsx', status: 'A' },
        ] },
      ] },
      { rel: 'src/renderer/styles', name: 'styles', dir: true, children: [{ rel: 'src/renderer/styles/globals.css', name: 'globals.css', status: 'M' }] },
      { rel: 'src/renderer/App.tsx', name: 'App.tsx', status: 'M' },
    ] },
    { rel: 'src/shared', name: 'shared', dir: true, children: [{ rel: 'src/shared/i18n.ts', name: 'i18n.ts' }] },
  ] },
  { rel: 'AGENTS.md', name: 'AGENTS.md' },
  { rel: 'package.json', name: 'package.json' },
  { rel: 'pnpm-lock.yaml', name: 'pnpm-lock.yaml', status: 'U' },
];

export const sources: Record<string, string> = {
  'src/renderer/App.tsx': `import { AppRail } from '@/components/app/AppRail';
import { StatusBar } from '@/components/app/StatusBar';
import { TitleBar } from '@/components/app/TitleBar';
import { Sidebar } from '@/components/chat/Sidebar';
import { SidePanel } from '@/components/sidepanel/SidePanel';

const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="relative isolate flex h-screen flex-col">
      <TitleBar title="EnsoCode" />
      {/* 平铺外壳：图标轨 + 侧栏 + 工作区 */}
      <div className="flex min-h-0 flex-1">
        <AppRail sidebarCollapsed={collapsed} />
        <Sidebar collapsed={collapsed} />
        <ChatView />
        <SidePanel />
      </div>
      <StatusBar />
    </div>
  );
}`,
  'src/renderer/components/chat/Sidebar.tsx': `export function Sidebar({ width, collapsed }: SidebarProps) {
  const { t } = useI18n();
  const botModeEnabled = useSettingsStore((s) => s.botModeEnabled);
  return (
    <motion.aside data-slot="project-sidebar">
      {botModeEnabled ? <ModeSwitch /> : <SearchButton />}
      <NewTaskButton />
      <GroupChips />
    </motion.aside>
  );
}`,
  'src/renderer/styles/globals.css': `.ocean-light {
  --background: 205 35% 94%;
  --radius: 6px;
  --content-area: 205 30% 97%;
  --input: 205 32% 96%;
}`,
  'AGENTS.md': `# EnsoCode 开发约定

本文件是项目对人类和 AI 贡献者都适用的长期约定。

## 开发原则

- 变更范围保持最小，不做无关重构或功能扩展。
- 优先复用现有实现模式。

## 提交前检查

\`\`\`bash
pnpm typecheck && pnpm lint && pnpm test
\`\`\``,
  'package.json': `{
  "name": "enso-code",
  "private": true,
  "scripts": {
    "dev": "electron-vite dev",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}`,
};

export const contentHits = [
  { rel: 'src/renderer/components/chat/Sidebar.tsx', line: 740, text: '<ModeSwitch className="h-9 flex-1" />' },
  { rel: 'src/renderer/components/chat/Sidebar.tsx', line: 834, text: '<GroupChips groups={projectGroups} />' },
  { rel: 'src/renderer/App.tsx', line: 19, text: "import { ModeSwitch } from '@/components/bots/ModeSwitch';" },
  { rel: 'src/renderer/components/bots/BotView.tsx', line: 42, text: '<ModeSwitch />' },
];

export const flatFiles = (nodes: TreeNode[] = tree): TreeNode[] => nodes.flatMap((node) => (node.dir ? flatFiles(node.children) : [node]));
export const fileIcon = (name: string) =>
  name.endsWith('.tsx') || name.endsWith('.ts') ? 'icon-[lucide--file-code-2] text-primary'
    : name.endsWith('.md') ? 'icon-[lucide--file-text] text-muted'
      : name.endsWith('.css') ? 'icon-[lucide--file-code] text-warning'
        : /\.(png|jpe?g)$/.test(name) ? 'icon-[lucide--file-image] text-success'
          : name.endsWith('.json') || name.endsWith('.yaml') ? 'icon-[lucide--file-json] text-muted'
            : 'icon-[lucide--file] text-muted';
