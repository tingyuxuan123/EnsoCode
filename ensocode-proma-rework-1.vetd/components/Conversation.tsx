import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { EnsoMark } from './Shell';
import { DangerConfirm, MenuItem, MenuLabel, MenuPanel, MenuSeparator, StatusDot, useDismiss } from './Controls';
import { added, changes, coworkers, removed } from './data';
import { useWorkbench } from './Workbench';

/** 会话头：主会话 + 持久协作者页签（X 只关视图，解雇走菜单二次确认）+ 工作区徽标 */
export function CoworkerTabs({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const { setNotice } = useWorkbench();
  const [menu, setMenu] = useState('');
  const [adding, setAdding] = useState(false);
  const [dismiss, setDismiss] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(Boolean(menu) || adding, () => { setMenu(''); setAdding(false); });
  const badgeRef = useDismiss<HTMLDivElement>(badgeOpen, () => setBadgeOpen(false));
  const tab = (selected: boolean) => `relative flex h-full shrink-0 items-center gap-1.5 px-3 text-[13px] ${selected ? 'font-medium text-surface-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary' : 'text-muted hover:text-surface-foreground'}`;
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-4">
      <div ref={menuRef} className="relative flex h-full min-w-0 flex-1 items-center gap-1">
        <button className={tab(active === 'main')} onClick={() => onSelect('main')} onDoubleClick={() => setNotice('双击页签可重命名会话标题（设计预览）。')}>
          <span className="icon-[lucide--messages-square] size-3.5" />
          主会话
        </button>
        {coworkers.filter((item) => !hidden.includes(item.id)).map((item) => (
          <div key={item.id} className="group flex h-full shrink-0 items-center">
            <button className={tab(active === item.id)} onClick={() => onSelect(item.id)}>
              <span className="icon-[lucide--bot] size-3.5" />
              {item.name}
              <StatusDot tone={item.tone} size="sm" />
            </button>
            <button aria-label="协作者操作" title="协作者操作" onClick={() => setMenu(item.id)} className="flex size-5 items-center justify-center rounded text-muted opacity-0 hover:bg-hover group-hover:opacity-100"><span className="icon-[lucide--ellipsis] size-3.5" /></button>
            <button aria-label="关闭对话视图" title="关闭对话视图（不会停止代理）" onClick={() => { setHidden([...hidden, item.id]); if (active === item.id) onSelect('main'); }} className="flex size-5 items-center justify-center rounded text-muted opacity-0 hover:bg-hover group-hover:opacity-100"><span className="icon-[lucide--x] size-3" /></button>
            {menu === item.id && (
              <MenuPanel label="协作者操作" className="left-24 top-10 w-48">
                <MenuItem icon="icon-[lucide--pencil]" label="重命名" onClick={() => setMenu('')} />
                <MenuItem icon="icon-[lucide--refresh-cw]" label="重新加载会话" onClick={() => setMenu('')} />
                <MenuItem icon="icon-[lucide--rotate-ccw]" label="重新打开协作者" onClick={() => setMenu('')} />
                <MenuSeparator />
                <MenuItem icon="icon-[lucide--user-x]" label="解雇协作者" danger onClick={() => { setMenu(''); setDismiss(item.name); }} />
              </MenuPanel>
            )}
          </div>
        ))}
        {hidden.length > 0 && <button onClick={() => setHidden([])} className="shrink-0 px-2 text-[12px] text-faint hover:text-surface-foreground">+{hidden.length} 已收起</button>}
        <button aria-label="添加协作者" title="添加协作者" onClick={() => setAdding(!adding)} className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-control text-faint hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--plus] size-3.5" /></button>
        {adding && (
          <MenuPanel label="添加协作者" className="left-48 top-10 w-80">
            <div className="p-2">
              <p className="text-[13px] font-medium">添加协作者</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">持久协作者可以接收后续消息。一次性任务由 agent 派发，在「代理」中查看。</p>
              <label className="mt-3 block text-[11px] text-muted">协作者名称<input defaultValue="文档整理" className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[13px] text-surface-foreground outline-none" /></label>
              <label className="mt-2 block text-[11px] text-muted">子代理类型
                <select className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[13px] text-surface-foreground"><option>worker · 跟随会话模型,全部工具</option><option>reviewer · 只读</option><option>scout · 只读</option></select>
              </label>
              <p className="mt-2 text-[11px] text-faint">同时在编 2 / 4 个协作者</p>
              <div className="mt-3 flex justify-end gap-2"><button onClick={() => setAdding(false)} className="px-2 py-1 text-[12px] text-muted">取消</button><button onClick={() => { setAdding(false); setNotice('正在添加协作者…（设计预览）'); }} className="rounded-control bg-surface-foreground px-3 py-1 text-[12px] text-surface">添加</button></div>
            </div>
          </MenuPanel>
        )}
      </div>
      <div ref={badgeRef} className="relative">
        <button onClick={() => setBadgeOpen(!badgeOpen)} title="~/githubproject/EnsoCode" className="group ml-1.5 flex h-6 items-center gap-1.5 rounded-full border border-border/70 px-2 font-mono text-[11px] text-muted hover:border-border">
          <span className="icon-[lucide--folder] size-3" />
          <span className="hidden group-hover:inline">EnsoCode</span>
          <span className="hidden opacity-40 group-hover:inline">/</span>
          <span className="icon-[lucide--git-branch] hidden size-3 group-hover:inline-block" />
          <span className="hidden group-hover:inline">main</span>
          <StatusDot tone="running" size="sm" />
        </button>
        {badgeOpen && (
          <MenuPanel label="打开方式" className="right-0 top-8 w-52">
            <MenuItem icon="icon-[lucide--folder-open]" label="在访达中打开" onClick={() => setBadgeOpen(false)} />
            <MenuSeparator />
            <MenuLabel>编辑器</MenuLabel>
            <MenuItem icon="icon-[lucide--code-2]" label="Visual Studio Code" onClick={() => setBadgeOpen(false)} />
            <MenuItem icon="icon-[lucide--code-2]" label="Cursor" onClick={() => setBadgeOpen(false)} />
            <MenuSeparator />
            <MenuLabel>终端</MenuLabel>
            <MenuItem icon="icon-[lucide--square-terminal]" label="Ghostty" onClick={() => setBadgeOpen(false)} />
            <MenuSeparator />
            <MenuItem icon="icon-[lucide--copy]" label="复制路径" onClick={() => setBadgeOpen(false)} />
          </MenuPanel>
        )}
      </div>
      {dismiss && <DangerConfirm title={`解雇 ${dismiss}？`} description="此操作会结束协作者会话并停止其工作。若只是收起界面，请关闭对话视图。" confirmLabel="解雇协作者" requireCheck={false} onClose={() => setDismiss('')} onConfirm={() => setDismiss('')} />}
    </header>
  );
}

/** 用户消息：悬停出复制 / 撤回 / 回退（仅对话 · 对话+还原文件）/ 对话分支 */
export function UserMessage({ children, time = '14:32' }: { children: ReactNode; time?: string }) {
  const { setNotice } = useWorkbench();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'' | 'chat' | 'files'>('');
  const ref = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  return (
    <div className="group mb-6 flex flex-col items-end">
      <div className="max-w-[86%] rounded-control bg-panel px-4 py-2.5 text-[14px] leading-6">{children}</div>
      <div ref={ref} className="relative mt-1 flex h-6 items-center gap-0.5 text-faint opacity-0 group-hover:opacity-100">
        <span className="mr-1 text-[11px]">{time}</span>
        <button title="复制" className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-surface-foreground" onClick={() => setNotice('已复制。')}><span className="icon-[lucide--copy] size-3.5" /></button>
        <button title="保留源线，从这里开对话分支" className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-surface-foreground" onClick={() => setNotice('已从这里开对话分支：新会话出现在侧栏，标注「分支自」。')}><span className="icon-[lucide--git-fork] size-3.5" /></button>
        <button title="回退" className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-surface-foreground" onClick={() => setMenu(!menu)}><span className="icon-[lucide--undo-2] size-3.5" /></button>
        {menu && (
          <MenuPanel label="回退" className="right-0 top-7 w-72">
            <MenuItem icon="icon-[lucide--message-square]" label="仅回退对话" hint="回退到这条消息（其后的消息移出当前分支,文本回填输入框）" onClick={() => { setMenu(false); setConfirm('chat'); }} />
            <MenuItem icon="icon-[lucide--file-clock]" label="对话+还原文件" hint="回退对话并把工作树还原到这一轮之前（git 项目有效）" onClick={() => { setMenu(false); setConfirm('files'); }} />
          </MenuPanel>
        )}
      </div>
      {confirm && <DangerConfirm title="回退到这条消息?" description={confirm === 'files' ? '其后的消息将移出当前分支,并把工作树文件还原到这一轮开始之前。' : '其后的消息将移出当前分支,该消息文本回填输入框。'} confirmLabel="回退" requireCheck={false} onClose={() => setConfirm('')} onConfirm={() => setConfirm('')} />}
    </div>
  );
}

const toolRows = [
  { icon: 'icon-[lucide--file-search]', text: '读了 6 个文件', detail: 'Sidebar.tsx · AppRail.tsx · TitleBar.tsx · globals.css …' },
  { icon: 'icon-[lucide--search]', text: '搜索 3 次', detail: 'rg "SidebarSectionLabel" · rg "bg-nav" · rg "GroupChips"' },
  { icon: 'icon-[lucide--square-terminal]', text: '跑了 2 条命令', detail: 'pnpm typecheck · pnpm lint' },
  { icon: 'icon-[lucide--file-pen]', text: '编辑 3 个文件', detail: 'App.tsx +24 −18 · Sidebar.tsx +32 −21 · globals.css +18 −8' },
];

/** 回合结束后折叠的工作过程：「已工作 4m12s」一行，展开看思考与工具调用 */
export function WorkedRow({ running = false }: { running?: boolean }) {
  const [open, setOpen] = useState(running);
  return (
    <div className="mb-3">
      <button aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 text-[12px] text-muted hover:text-surface-foreground">
        {running ? <span className="icon-[lucide--loader-circle] vetd-spin size-3.5 text-primary" /> : <span className="icon-[lucide--circle-check] size-3.5 text-success" />}
        {running ? '工作中 1m08s' : '已工作 4m12s'}
        <span className="text-faint">· 2 段思考 · 14 个工具调用{running ? '' : ' · 1 次调用失败'}</span>
        <span className={`${open ? 'icon-[lucide--chevron-up]' : 'icon-[lucide--chevron-down]'} size-3`} />
      </button>
      {open && (
        <div className="ml-[7px] mt-2 space-y-1.5 border-l border-border pl-4">
          <p className="text-[12px] italic leading-5 text-faint">思考：先确认侧栏的分组与置顶语义，再动布局；GroupChips 有横滑与拖入两种交互，需要保留……</p>
          {toolRows.map((row) => (
            <div key={row.text} className="flex items-start gap-2 text-[12px]">
              <span className={`${row.icon} mt-0.5 size-3.5 shrink-0 text-muted`} />
              <span className="font-medium">{row.text}</span>
              <span className="min-w-0 truncate text-muted">{row.detail}</span>
            </div>
          ))}
          {!running && <div className="flex items-start gap-2 text-[12px] text-danger"><span className="icon-[lucide--circle-x] mt-0.5 size-3.5 shrink-0" /><span className="font-medium">1 次调用失败</span><span className="min-w-0 truncate">pnpm test · 2 failed，已在下一步修复</span></div>}
          {running && <div className="flex items-center gap-2 text-[12px] text-muted"><span className="icon-[lucide--loader-circle] vetd-spin size-3.5 text-primary" />正在运行 pnpm test …</div>}
        </div>
      )}
    </div>
  );
}

export function AssistantHeader({ time = '14:33', name = 'EnsoCode' }: { time?: string; name?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[12px]">
      <EnsoMark className="size-[17px]" />
      <span className="font-medium">{name}</span>
      <span className="text-faint">{time}</span>
    </div>
  );
}

/** 本轮文件改动卡（TurnFilesCard） */
export function TurnFilesCard() {
  const { openSideTab } = useWorkbench();
  return (
    <div className="my-4 rounded-control border border-line">
      <div className="flex h-9 items-center gap-2 bg-panel/60 px-3 text-[12px]">
        <span className="icon-[lucide--files] size-3.5 text-muted" />
        <span className="font-medium">{changes.length} 个文件已修改</span>
        <span className="ml-auto text-success">+{added}</span>
        <span className="text-danger">−{removed}</span>
      </div>
      {changes.map((file) => (
        <button key={file.name} onClick={() => openSideTab('changes')} className="flex h-9 w-full items-center gap-2 border-t border-line px-3 text-left text-[12px] hover:bg-hover">
          <span className="icon-[lucide--file-code-2] size-3.5 text-primary" />
          <span>{file.name}</span>
          <span className="min-w-0 truncate text-faint">{file.folder}</span>
          <span className="ml-auto text-success">+{file.added}</span>
          <span className="text-danger">−{file.removed}</span>
        </button>
      ))}
    </div>
  );
}

/** 助手消息操作：复制 / 重试 */
export function AssistantActions() {
  const { setNotice } = useWorkbench();
  return (
    <div className="mt-3 flex items-center gap-1 text-faint">
      <button title="复制" onClick={() => setNotice('已复制。')} className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--copy] size-3.5" /></button>
      <button title="重试" onClick={() => setNotice('重试本轮：重新生成回复（设计预览）。')} className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--refresh-cw] size-3.5" /></button>
      <span className="ml-1 text-[11px]">用时 4m12s · Claude Sonnet 4.5</span>
      <Link to="/review" className="ml-auto text-[12px] text-primary">打开改动审查</Link>
    </div>
  );
}

/** 时间线里的系统事件分隔：压缩 / 进入 Plan / worktree 迁移 / 账号接替 */
export function TimelineEvent({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[11px] text-faint">
      <span className="h-px flex-1 bg-line" />
      <span className={`${icon} size-3.5`} />
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
