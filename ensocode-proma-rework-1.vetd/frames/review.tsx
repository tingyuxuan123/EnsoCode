export const frame = { width: 1440, height: 900, title: "改动审查" };

import { useState } from 'react';
import { Link } from 'react-router';
import { added, changes, removed, taskTitle } from '../components/data';
import { useWorkbench } from '../components/Workbench';

type DiffLine = { before: string; after: string; kind?: 'change' | 'add' };
const previews: Record<string, DiffLine[]> = {
  'App.tsx': [
    { before: 'export default function App() {', after: 'export default function App() {' },
    { before: '  return (', after: '  return (' },
    { before: '    <div className="app-shell">', after: '    <div className="workbench">', kind: 'change' },
    { before: '      <TitleBar />', after: '      <TitleBar />' },
    { before: '      <div className="workspace">', after: '      <div className="workspace">' },
    { before: '', after: '        <NavigationRail />', kind: 'add' },
    { before: '        <Sidebar />', after: '        <ProjectSidebar />', kind: 'change' },
    { before: '        <ChatView />', after: '        <ChatView />' },
    { before: '        <SidePanel />', after: '        <WorkspaceInspector />', kind: 'change' },
    { before: '      </div>', after: '      </div>' },
    { before: '', after: '      <WorkspaceStatusBar />', kind: 'add' },
    { before: '    </div>', after: '    </div>' },
    { before: '  );', after: '  );' },
    { before: '}', after: '}' },
  ],
  'Sidebar.tsx': [
    { before: 'export function Sidebar() {', after: 'export function ProjectSidebar() {', kind: 'change' },
    { before: '  return (', after: '  return (' },
    { before: '    <aside className="sidebar">', after: '    <aside className="project-sidebar">', kind: 'change' },
    { before: '      <ProjectList />', after: '      <ProjectList />' },
    { before: '      <SessionList />', after: '      <SessionTree />', kind: 'change' },
    { before: '', after: '      <ArchiveEntry />', kind: 'add' },
    { before: '    </aside>', after: '    </aside>' },
    { before: '  );', after: '  );' },
    { before: '}', after: '}' },
  ],
  'globals.css': [
    { before: ':root {', after: ':root {' },
    { before: '  --radius: 12px;', after: '  --radius: 6px;', kind: 'change' },
    { before: '  --sidebar: #ffffff;', after: '  --sidebar: hsl(205 35% 94%);', kind: 'change' },
    { before: '  --content: #ffffff;', after: '  --content: hsl(205 30% 97%);', kind: 'change' },
    { before: '', after: '  --input: hsl(205 32% 96%);', kind: 'add' },
    { before: '}', after: '}' },
    { before: '', after: '' },
    { before: '.workspace {', after: '.workspace {' },
    { before: '  gap: 8px;', after: '  gap: 0;', kind: 'change' },
    { before: '}', after: '}' },
  ],
};

export default function ReviewScreen() {
  const [selected, setSelected] = useState(changes[0].name);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [unified, setUnified] = useState(false);
  const { setNotice } = useWorkbench();
  const active = changes.find((file) => file.name === selected)!;
  const lines = previews[selected];
  const allReviewed = reviewed.length === changes.length;
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-7 py-5">
        <div className="min-w-0"><h1 className="text-[20px] font-semibold">改动审查</h1><p className="mt-1.5 truncate text-[12px] text-muted">{taskTitle}<span className="mx-2">·</span>{changes.length} 个文件<span className="ml-3 text-success">+{added}</span><span className="ml-1.5 text-danger">−{removed}</span></p></div>
        <Link to="/" className="ml-auto flex shrink-0 items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[12px] hover:bg-hover"><span className="icon-[lucide--arrow-left] size-3.5" />返回会话</Link>
      </header>
      <section className="flex min-h-0 flex-1">
        <aside className="flex w-[236px] shrink-0 flex-col border-r border-line px-3 py-4">
          <div className="mb-3 flex items-center px-2 text-[12px] text-muted">会话文件<span className="ml-auto">{reviewed.length} / {changes.length} 已查看</span></div>
          {changes.map((file) => (
            <button key={file.name} className={`mb-1 flex items-center gap-2 rounded-control px-2 py-3 text-left ${selected === file.name ? 'bg-selected' : 'hover:bg-hover'}`} onClick={() => setSelected(file.name)}>
              <span className={`${reviewed.includes(file.name) ? 'icon-[lucide--circle-check] text-success' : 'icon-[lucide--file-code-2] text-muted'} size-4 shrink-0`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 whitespace-nowrap text-[12px] font-medium">
                  {file.name}
                  <span className="text-[11px] font-normal"><span className="text-success">+{file.added}</span><span className="ml-2 text-danger">−{file.removed}</span></span>
                </span>
              </span>
            </button>
          ))}
          <div className="mt-auto border-t border-line px-2 pt-4 text-[11px] leading-5 text-muted"><div className="mb-2 flex items-center gap-1.5"><span className="icon-[lucide--git-branch] size-3" />main</div><p>对比当前会话的改动快照。</p><p className="mt-2">本页为演示数据，代码片段仅用于预览排版。</p></div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-[47px] shrink-0 items-center gap-2 border-b border-line px-4 text-[12px]">
            <span className="icon-[lucide--file-code-2] size-3.5 text-primary" /><span className="min-w-0 flex-1 truncate">{active.folder}/{active.name}</span>
            <button onClick={() => setUnified(!unified)} className="flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-muted hover:bg-hover"><span className={`${unified ? 'icon-[lucide--columns-2]' : 'icon-[lucide--align-left]'} size-3.5`} />{unified ? '并排' : '统一'}</button>
            <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-muted"><input type="checkbox" checked={reviewed.includes(selected)} onChange={(event) => setReviewed(event.target.checked ? [...reviewed, selected] : reviewed.filter((name) => name !== selected))} className="size-3.5 accent-current" />已查看</label>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className={`grid ${unified ? 'grid-cols-1' : 'grid-cols-2'} border-b border-line bg-panel/50 text-[11px] text-muted`}>
              {!unified && <div className="border-r border-line px-4 py-2">修改前</div>}
              <div className="px-4 py-2">{unified ? '统一对比' : '修改后'}</div>
            </div>
            <div className="min-w-[600px] py-2 font-mono text-[11px] leading-[27px]">
              <div className="mb-1 bg-panel/65 px-4 text-[11px] text-muted">@@ 界面结构调整 · 节选 @@</div>
              {lines.map((line, index) => unified ? (
                <div key={index}>
                  {line.kind === 'change' && <div className="flex bg-danger-soft"><span className="w-10 shrink-0 pr-2 text-right text-faint">{index + 1}</span><span className="w-6 shrink-0 text-center text-danger">−</span><span className="whitespace-pre px-1">{line.before}</span></div>}
                  <div className={`flex ${line.kind ? 'bg-success-soft' : ''}`}><span className="w-10 shrink-0 pr-2 text-right text-faint">{index + 1}</span><span className="w-6 shrink-0 text-center text-success">{line.kind ? '+' : ''}</span><span className="whitespace-pre px-1">{line.after}</span></div>
                </div>
              ) : (
                <div key={index} className="grid grid-cols-2">
                  <div className={`flex min-w-0 overflow-hidden border-r border-line ${line.kind === 'change' ? 'bg-danger-soft' : ''}`}><span className="w-8 shrink-0 pr-2 text-right text-faint">{line.before ? index + 1 : ''}</span><span className="w-4 shrink-0 text-danger">{line.kind === 'change' ? '−' : ''}</span><span className="whitespace-pre">{line.before}</span></div>
                  <div className={`flex min-w-0 overflow-hidden ${line.kind ? 'bg-success-soft' : ''}`}><span className="w-8 shrink-0 pr-2 text-right text-faint">{index + 1}</span><span className="w-4 shrink-0 text-success">{line.kind ? '+' : ''}</span><span className="whitespace-pre">{line.after}</span></div>
                </div>
              ))}
            </div>
            <div className="mx-5 mb-5 mt-6 border-t border-line pt-5">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-medium"><span className="icon-[lucide--shield-check] size-4 text-success" />验收摘要<span className="ml-auto text-[11px] font-normal text-faint">演示结果</span></div>
              <div className="grid grid-cols-3 gap-3 text-[12px] text-muted">{['类型检查', '代码规范', '界面回归'].map((label) => <div className="flex items-center gap-1.5" key={label}><span className="icon-[lucide--check] size-3 text-success" />{label}</div>)}</div>
              <p className="mt-4 text-[12px] leading-6 text-muted">只调整工作区布局和样式，未变更会话持久化、审批策略与 Agent 调用链路。</p>
            </div>
          </div>
          <div className="flex h-[62px] shrink-0 items-center gap-3 border-t border-line px-5">
            <button className="flex items-center gap-1.5 text-[12px] text-muted hover:text-surface-foreground" onClick={() => setNotice('设计预览：真实应用中的检查点会恢复工作树，本稿不会执行回滚。')}><span className="icon-[lucide--history] size-3.5" />检查点</button>
            <span className="ml-auto text-[11px] text-muted">{allReviewed ? '所有文件已查看' : `还有 ${changes.length - reviewed.length} 个文件待查看`}</span>
            <button className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface" onClick={() => { setReviewed(changes.map((file) => file.name)); setNotice('已标记本次演示改动为审查完成；真实代码与 Git 状态未改变。'); }}>完成审查</button>
          </div>
        </div>
      </section>
    </div>
  );
}
