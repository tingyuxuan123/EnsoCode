import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { MenuItem, MenuLabel, MenuPanel, MenuSeparator, StatusDot, useDismiss } from './Controls';
import { activeSessionIds, archivedCount, groups, projects, type Project, type Session } from './data';
import { ModeSwitch } from './Shell';
import { useWorkbench } from './Workbench';

function SectionLabel({ children }: { children: string }) {
  return <div className="px-2 pb-1 pt-2 text-[11px] text-faint">{children}</div>;
}

/** 会话行：状态点 + 标题 + 相对时间；悬停出置顶/归档；右键 / 更多菜单；隔离 worktree 显示第二行 */
function SessionRow({ session, active }: { session: Session; active: boolean }) {
  const navigate = useNavigate();
  const { setNotice } = useWorkbench();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(session.title);
  const ref = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !renaming && navigate('/')}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(event) => { event.preventDefault(); setMenu(true); }}
        className={`group grid min-h-9 cursor-pointer grid-cols-[14px_minmax(0,1fr)] items-center gap-x-2 rounded-control py-1.5 pl-2 pr-1.5 text-[13px] ${active ? 'bg-selected font-medium text-surface-foreground' : 'text-muted hover:bg-hover hover:text-surface-foreground'}`}
      >
        <span className="flex justify-center"><StatusDot tone={session.dot} /></span>
        <div className="flex min-w-0 items-center gap-1.5">
          {session.forkedFrom && <span className="max-w-[70px] shrink-0 truncate text-[11px] font-normal text-faint">分支自 {session.forkedFrom}</span>}
          {renaming ? (
            <input autoFocus aria-label="重命名会话" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => setRenaming(false)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') setRenaming(false); }} className="h-6 min-w-0 flex-1 rounded-[4px] border border-primary/60 bg-surface px-1.5 text-[13px] outline-none" />
          ) : (
            <span className="min-w-0 flex-1 truncate">{title}</span>
          )}
          {!renaming && (
            <>
              {session.pinned && <span className="icon-[lucide--pin] size-3 shrink-0 text-faint group-hover:hidden" />}
              <span className="shrink-0 text-[11px] font-normal tabular-nums text-faint group-hover:hidden">{session.time}</span>
              <button title={session.pinned ? '取消置顶' : '置顶'} onClick={(event) => { event.stopPropagation(); setNotice('已置顶会话（设计预览）。拖动会话到「已置顶」也可置顶。'); }} className="hidden size-5 shrink-0 items-center justify-center rounded text-muted hover:text-surface-foreground group-hover:flex"><span className="icon-[lucide--pin] size-3.5" /></button>
              <button title="归档" onClick={(event) => { event.stopPropagation(); setNotice('会话已移入「已归档」（设计预览）。'); }} className="hidden size-5 shrink-0 items-center justify-center rounded text-muted hover:text-surface-foreground group-hover:flex"><span className="icon-[lucide--archive] size-3.5" /></button>
            </>
          )}
        </div>
        {session.worktree && (
          <div className="col-start-2 flex min-w-0 items-center gap-1 text-[11px] font-normal text-faint">
            <span className="icon-[lucide--git-fork] size-3 shrink-0" />
            <span className="truncate font-mono">{session.worktree}</span>
            <span className="ml-auto shrink-0 text-warning">有未提交改动</span>
          </div>
        )}
      </div>
      {menu && (
        <MenuPanel label="会话操作" className="left-6 top-8 w-52">
          <MenuItem icon="icon-[lucide--pencil]" label="重命名" onClick={() => { setMenu(false); setRenaming(true); }} />
          <MenuItem icon="icon-[lucide--refresh-cw]" label="重新加载会话" onClick={() => { setMenu(false); setNotice('重新加载会话：从 jsonl 重建时间线（设计预览）。'); }} />
          <MenuItem icon="icon-[lucide--pin]" label={session.pinned ? '取消置顶' : '置顶'} onClick={() => setMenu(false)} />
          <MenuItem icon="icon-[lucide--archive]" label="归档" onClick={() => setMenu(false)} />
          {session.worktree && (
            <>
              <MenuSeparator />
              <MenuItem icon="icon-[lucide--message-square-plus]" label="在此 worktree 新建会话" onClick={() => setMenu(false)} />
              <MenuItem icon="icon-[lucide--pencil-line]" label="重命名 worktree" onClick={() => setMenu(false)} />
              <MenuItem icon="icon-[lucide--brush-cleaning]" label="清理 worktree" onClick={() => { setMenu(false); setNotice('清理 worktree？待处理工作：有未提交改动。本会话将回退主工作树；分支会保留。'); }} />
            </>
          )}
          {!session.worktree && <MenuItem icon="icon-[lucide--git-fork]" label="移到 worktree" onClick={() => setMenu(false)} />}
          <MenuSeparator />
          <MenuItem icon="icon-[lucide--trash-2]" label="删除" danger onClick={() => { setMenu(false); setNotice('删除会话？此对话将从列表中移除（设计预览不执行）。'); }} />
        </MenuPanel>
      )}
    </div>
  );
}

function ProjectNode({ project, folded, onToggle }: { project: Project; folded: boolean; onToggle: () => void }) {
  const { setProjectDialog, setDialogProject, setNotice } = useWorkbench();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const ref = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const open = (dialog: 'settings' | 'import' | 'remove' | 'group') => { setMenu(false); setDialogProject(project.id); setProjectDialog(dialog); };
  const shown = expanded ? project.sessions : project.sessions.slice(0, 3);
  return (
    <div ref={ref} className="relative">
      <div onContextMenu={(event) => { event.preventDefault(); setMenu(true); }} className="group flex h-9 items-center gap-1 rounded-control px-2 hover:bg-hover">
        <button onClick={onToggle} aria-expanded={!folded} title={project.local ? `~/githubproject/${project.name}` : `${project.host}:/srv/${project.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`${folded ? 'icon-[lucide--folder-git-2]' : 'icon-[lucide--folder-open]'} size-4 shrink-0 text-muted`} />
          <span className="min-w-0 truncate text-[13px] font-medium">{project.name}</span>
          {!project.local && <span className="shrink-0 rounded-[4px] bg-control px-1 py-0.5 text-[11px] text-muted">{project.host}</span>}
        </button>
        <button title={project.pinned ? '取消置顶项目' : '置顶项目'} className="hidden size-6 shrink-0 items-center justify-center rounded-control text-muted hover:bg-control group-hover:flex"><span className={`${project.pinned ? 'icon-[lucide--pin-off]' : 'icon-[lucide--pin]'} size-3.5`} /></button>
        <Link to="/new-task" title="新对话" className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 hover:bg-control group-hover:opacity-100"><span className="icon-[lucide--message-square-plus] size-3.5" /></Link>
        <button title="更多操作" aria-label="更多操作" onClick={() => setMenu(!menu)} className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 hover:bg-control group-hover:opacity-100"><span className="icon-[lucide--ellipsis] size-3.5" /></button>
        {project.pinned && <span className="icon-[lucide--pin] size-3.5 shrink-0 text-faint group-hover:hidden" />}
      </div>
      {menu && (
        <MenuPanel label="项目操作" className="right-1 top-9 w-48">
          <MenuItem icon={project.pinned ? 'icon-[lucide--pin-off]' : 'icon-[lucide--pin]'} label={project.pinned ? '取消置顶项目' : '置顶项目'} onClick={() => setMenu(false)} />
          <MenuItem icon="icon-[lucide--settings-2]" label="项目设置" onClick={() => open('settings')} />
          <MenuItem icon="icon-[lucide--folder-open]" label="在访达中打开" onClick={() => setMenu(false)} />
          <MenuItem icon="icon-[lucide--history]" label="导入会话" onClick={() => open('import')} />
          <MenuSeparator />
          <MenuLabel>移动到分组</MenuLabel>
          <MenuItem label="未分组" checked={!project.group} onClick={() => setMenu(false)} />
          {groups.map((group) => <MenuItem key={group.id} label={group.name} checked={project.group === group.id} onClick={() => setMenu(false)} />)}
          <MenuItem icon="icon-[lucide--layers]" label="新建分组" onClick={() => open('group')} />
          <MenuSeparator />
          <MenuItem icon="icon-[lucide--archive]" label="归档项目" onClick={() => { setMenu(false); setNotice('项目已归档，可在「已归档」中取消归档（设计预览）。'); }} />
          <MenuItem icon="icon-[lucide--folder-x]" label="移除项目" danger onClick={() => open('remove')} />
        </MenuPanel>
      )}
      {!folded && (
        <div className="mt-0.5 flex flex-col gap-y-0.5">
          {shown.map((session) => <SessionRow key={session.id} session={session} active={pathname !== '/new-task' && session.id === 's1'} />)}
          {project.sessions.length > 3 && (
            <button onClick={() => setExpanded(!expanded)} className="py-1 pl-8 text-left text-[12px] text-faint hover:text-surface-foreground">{expanded ? '收起' : `显示另外 ${project.sessions.length - 3} 个`}</button>
          )}
          {!project.sessions.length && <p className="py-1.5 pl-8 text-[12px] text-faint">还没有对话</p>}
        </div>
      )}
    </div>
  );
}

/** 节点切换（侧栏底部）：本机 / 已配对节点 / 连接到节点… */
function NodeSwitcher() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} title="切换节点" className="flex h-7 items-center gap-1.5 rounded-control px-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        <span className="icon-[lucide--laptop] size-3.5" />
        本机
        <span className="icon-[lucide--chevrons-up-down] size-3" />
      </button>
      {open && (
        <MenuPanel label="切换节点" className="bottom-8 left-0 w-56">
          <MenuItem icon="icon-[lucide--laptop]" label="本机" checked />
          <MenuItem icon="icon-[lucide--monitor]" label="工作室 Mac mini" hint="在线 · 直连" onClick={() => navigate('/remote-node')} />
          <MenuItem icon="icon-[lucide--monitor]" label="家里的 iMac" hint="对方桌面离线" disabled />
          <MenuSeparator />
          <MenuItem icon="icon-[lucide--link]" label="连接到节点…" onClick={() => navigate('/node-pair')} />
        </MenuPanel>
      )}
    </div>
  );
}

/** Code 模式侧栏（chat/Sidebar.tsx）。宽度默认 264，可拖 200–420 */
export function CodeSidebar() {
  const { compact, botModeEnabled, setSearchOpen, setProjectDialog, setDialogProject } = useWorkbench();
  const [folded, setFolded] = useState<string[]>(['phone', 'design']);
  const [addMenu, setAddMenu] = useState(false);
  const [chip, setChip] = useState('all');
  const [chipSearch, setChipSearch] = useState(false);
  const [query, setQuery] = useState('');
  const addRef = useDismiss<HTMLDivElement>(addMenu, () => setAddMenu(false));
  if (compact) return null;
  const all = projects.flatMap((project) => project.sessions);
  const active = all.filter((session) => activeSessionIds.includes(session.id));
  const matches = (project: Project) => !query || `${project.name} ${project.sessions.map((session) => session.title).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  const scoped = projects.filter((project) => (chip === 'all' || chip === 'recent' ? true : chip === 'none' ? !project.group : project.group === chip) && matches(project));
  const pinned = scoped.filter((project) => project.pinned);
  const grouped = chip === 'all';
  const toggle = (id: string) => setFolded(folded.includes(id) ? folded.filter((item) => item !== id) : [...folded, id]);
  const chips = [{ id: 'all', label: '全部', count: projects.length }, { id: 'recent', label: '最近', count: 2 }, ...groups.map((group) => ({ id: group.id, label: group.name, count: projects.filter((project) => project.group === group.id).length, color: group.color })), { id: 'none', label: '未分组', count: 1 }];
  return (
    <aside aria-label="项目与会话" className="flex w-[264px] shrink-0 flex-col bg-sidebar">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
        {botModeEnabled ? (
          <>
            <ModeSwitch className="h-9 flex-1" />
            <button onClick={() => setSearchOpen(true)} title="搜索任意内容 (⌘K)" className="flex size-9 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--search] size-4" /></button>
          </>
        ) : (
          <button onClick={() => setSearchOpen(true)} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-[13px] text-muted hover:bg-hover">
            <span className="icon-[lucide--search] size-4" />
            <span className="flex-1 text-left">搜索任意内容</span>
            <span className="text-[11px]">⌘K</span>
          </button>
        )}
      </div>
      <Link to="/new-task" className="mx-3 mt-3 flex h-9 shrink-0 items-center gap-2 rounded-control px-1.5 hover:bg-hover">
        <span className="icon-[lucide--circle-plus] size-[17px] text-primary" />
        <span className="text-[14px]">新建任务</span>
        <span className="ml-auto rounded border border-border px-1 text-[11px] text-muted">⌘N</span>
      </Link>
      <div ref={addRef} className="relative mt-4 flex shrink-0 items-center gap-1 px-4 text-[12px] text-muted">
        <span className="flex-1">项目</span>
        <button title={folded.length === projects.length ? '全部展开' : '全部折叠'} onClick={() => setFolded(folded.length === projects.length ? [] : projects.map((project) => project.id))} className="flex size-6 items-center justify-center rounded-control hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--chevrons-up-down] size-3.5" /></button>
        <button title="添加项目或分组" aria-expanded={addMenu} onClick={() => setAddMenu(!addMenu)} className={`flex size-6 items-center justify-center rounded-control hover:bg-hover hover:text-surface-foreground ${addMenu ? 'bg-hover text-surface-foreground' : ''}`}><span className="icon-[lucide--plus] size-4" /></button>
        {addMenu && (
          <MenuPanel label="添加项目或分组" className="right-3 top-7 w-44">
            <MenuItem icon="icon-[lucide--folder-plus]" label="添加项目" onClick={() => { setAddMenu(false); setProjectDialog('add'); }} />
            <MenuItem icon="icon-[lucide--layers]" label="新建分组" onClick={() => { setAddMenu(false); setDialogProject(''); setProjectDialog('group'); }} />
          </MenuPanel>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-2">
        {chipSearch ? (
          <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full bg-control/60 pl-2.5 pr-1 text-[12px] text-muted focus-within:ring-1 focus-within:ring-primary/45">
            <span className="icon-[lucide--text-search] size-3.5 shrink-0" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setChipSearch(false); } }} placeholder={chip === 'all' || chip === 'recent' ? '搜索会话...' : `在「${chips.find((item) => item.id === chip)?.label}」中搜索...`} className="min-w-0 flex-1 bg-transparent outline-none" aria-label="搜索会话" />
            <button aria-label="关闭" onClick={() => { setQuery(''); setChipSearch(false); }} className="flex size-5 items-center justify-center rounded-full hover:bg-control"><span className="icon-[lucide--x] size-3" /></button>
          </label>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {chips.map((item) => (
                <button key={item.id} onClick={() => setChip(item.id)} onDoubleClick={() => item.id.length > 4 && (setDialogProject(item.id), setProjectDialog('group-edit'))} className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] ${chip === item.id ? 'bg-surface-foreground text-surface' : 'bg-control/50 text-muted hover:bg-control hover:text-surface-foreground'}`}>
                  {'color' in item && item.color && <span className={`size-1.5 rounded-full ${item.color}`} />}
                  {item.label}
                  <span className="tabular-nums opacity-70">{item.count}</span>
                </button>
              ))}
            </div>
            <button title="搜索会话" onClick={() => setChipSearch(true)} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-control hover:text-surface-foreground"><span className="icon-[lucide--text-search] size-3.5" /></button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2 pt-1">
        {!query && chip === 'all' && (
          <div>
            <SectionLabel>活跃中</SectionLabel>
            <div className="flex flex-col gap-y-0.5">{active.map((session) => <SessionRow key={session.id} session={session} active={session.id === 's1'} />)}</div>
          </div>
        )}
        {!query && chip === 'all' && all.some((session) => session.pinned) && (
          <div>
            <SectionLabel>已置顶</SectionLabel>
            <div className="flex flex-col gap-y-0.5">{all.filter((session) => session.pinned).map((session) => <SessionRow key={session.id} session={session} active={false} />)}</div>
          </div>
        )}
        {chip === 'recent' && <SectionLabel>最近 7 天活跃的项目</SectionLabel>}
        {pinned.length > 0 && grouped && (
          <div>
            <SectionLabel>置顶项目</SectionLabel>
            {pinned.map((project) => <ProjectNode key={project.id} project={project} folded={folded.includes(project.id)} onToggle={() => toggle(project.id)} />)}
          </div>
        )}
        {grouped ? [...groups, { id: '', name: '未分组', color: '' }].map((group) => {
          const list = scoped.filter((project) => !project.pinned && project.group === group.id);
          if (!list.length) return null;
          return (
            <div key={group.id || 'none'}>
              <div className="group flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] text-faint">
                {group.color && <span className={`size-1.5 rounded-full ${group.color}`} />}
                {group.name}
                <span className="tabular-nums">{list.length}</span>
                {group.id && <button onClick={() => { setDialogProject(group.id); setProjectDialog('group-edit'); }} title="编辑分组" className="ml-auto hidden size-5 items-center justify-center rounded hover:bg-hover group-hover:flex"><span className="icon-[lucide--pencil] size-3" /></button>}
              </div>
              {list.map((project) => <ProjectNode key={project.id} project={project} folded={folded.includes(project.id)} onToggle={() => toggle(project.id)} />)}
            </div>
          );
        }) : scoped.map((project) => <ProjectNode key={project.id} project={project} folded={folded.includes(project.id)} onToggle={() => toggle(project.id)} />)}
        {!scoped.length && <p className="px-2 py-6 text-center text-[12px] text-muted">没有匹配的会话</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-1 px-3 pb-3 pt-2">
        <NodeSwitcher />
        <button onClick={() => setProjectDialog('archive')} title={`已归档 (${archivedCount})`} className="flex h-8 items-center gap-2 rounded-control px-2 text-[12px] text-muted hover:bg-hover hover:text-surface-foreground">
          <span className="icon-[lucide--archive] size-4" />
          已归档
          <span className="ml-auto text-[11px] tabular-nums">{archivedCount}</span>
        </button>
      </div>
    </aside>
  );
}
/** 兼容旧名称 */
export const Navigation = CodeSidebar;
