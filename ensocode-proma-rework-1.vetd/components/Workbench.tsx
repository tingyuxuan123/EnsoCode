import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { added, changes, files, projectName, projects, removed, settingsNav } from './data';

type WorkbenchState = {
  dark: boolean; setDark: (value: boolean) => void;
  compact: boolean; setCompact: (value: boolean) => void;
  inspectorOpen: boolean; setInspectorOpen: (value: boolean) => void;
  inspectorTab: string; setInspectorTab: (value: string) => void;
  approval: string; setApproval: (value: string) => void;
  model: string; setModel: (value: string) => void;
  notice: string; setNotice: (value: string) => void;
  activeFile: string; setActiveFile: (value: string) => void;
  task: string; setTask: (value: string) => void;
};
const WorkbenchContext = createContext<WorkbenchState | null>(null);
export function useWorkbench() {
  const state = useContext(WorkbenchContext);
  if (!state) throw new Error('工作台尚未初始化');
  return state;
}
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState('files');
  const [approval, setApproval] = useState('自动接受编辑');
  const [model, setModel] = useState('Claude Sonnet 4.5');
  const [notice, setNotice] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [task, setTask] = useState('');
  return (
    <WorkbenchContext.Provider value={{ dark, setDark, compact, setCompact, inspectorOpen, setInspectorOpen, inspectorTab, setInspectorTab, approval, setApproval, model, setModel, notice, setNotice, activeFile, setActiveFile, task, setTask }}>
      <div className={`${dark ? 'design-dark' : ''} flex h-full flex-col overflow-hidden bg-surface font-sans text-[14px] text-surface-foreground`}>
        {children}
      </div>
    </WorkbenchContext.Provider>
  );
}

export function WindowBar() {
  const { pathname } = useLocation();
  const { setInspectorOpen, inspectorOpen, setNotice } = useWorkbench();
  const title = pathname === '/coverage' ? '全功能 UI 重构 · 覆盖清单' : pathname === '/projects' ? '项目管理' : pathname === '/approvals' ? '运行控制' : pathname === '/settings' ? '外观设置' : pathname === '/new-task' ? '新建任务' : pathname === '/review' ? '改动审查' : '统一工作台布局与侧栏样式';
  return (
    <header className="flex h-[42px] shrink-0 items-center bg-panel">
      <div className="flex w-[90px] shrink-0 items-center gap-[7px] pl-[16px]" aria-label="桌面窗口">
        <span className="size-[11px] rounded-full bg-danger/75" />
        <span className="size-[11px] rounded-full bg-warning/70" />
        <span className="size-[11px] rounded-full bg-success/70" />
      </div>
      <span className="w-[230px] shrink-0 text-[12px] font-medium text-muted">EnsoCode <span className="ml-2 font-normal text-faint">工作台</span></span>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-5">
        <span className="truncate text-[13px] font-medium">{title}</span>
        <span className="icon-[lucide--chevron-down] size-3 text-muted" />
        <span className="ml-2 rounded-control bg-control/60 px-2 py-0.5 text-[11px] text-muted">{projectName}</span>
      </div>
      <Link to="/coverage" className="mr-3 flex items-center gap-1.5 whitespace-nowrap rounded-control px-2 py-1 text-[12px] text-muted hover:bg-hover">
        <span className="icon-[lucide--layout-list] size-3.5" />
        全功能清单
      </Link>
      <button className="mr-3 flex items-center gap-1.5 rounded-control px-2 py-1 text-[12px] text-muted hover:bg-hover" onClick={() => setNotice('设计预览：检查点用于在真实应用中恢复写入前的工作树，本稿不会修改文件。')}>
        <span className="icon-[lucide--history] size-3.5" />
        检查点
      </button>
      <button title="切换右侧面板" aria-label="切换右侧面板" className="mr-4 flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover" onClick={() => setInspectorOpen(!inspectorOpen)}>
        <span className="icon-[lucide--panel-right] size-4" />
      </button>
    </header>
  );
}

export function Navigation() {
  const { pathname } = useLocation();
  const { compact, setCompact, setNotice, setInspectorOpen, setInspectorTab } = useWorkbench();
  const [collapsed, setCollapsed] = useState<string[]>(['phone-companion', 'design-system', 'relay-service']);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [section, setSection] = useState('code');
  const [archive, setArchive] = useState(false);
  const isSettings = pathname === '/settings';
  const rails = [
    { to: '/', icon: 'icon-[lucide--panels-top-left]', label: '工作台', active: ['/', '/task-progress', '/background-agents'].includes(pathname) },
    { to: '/projects', icon: 'icon-[lucide--folders]', label: '项目管理', active: pathname === '/projects' },
    { to: '/approvals', icon: 'icon-[lucide--shield-check]', label: '运行控制', active: pathname === '/approvals' },
    { to: '/review', icon: 'icon-[lucide--list-checks]', label: '改动审查', active: pathname === '/review' },
    { to: '/settings', icon: 'icon-[lucide--blocks]', label: '技能与 MCP', active: false },
    { to: '/settings', icon: 'icon-[lucide--monitor]', label: '远程节点', active: false },
  ];
  return (
    <>
      <nav aria-label="全局导航" className="flex w-[56px] shrink-0 flex-col items-center gap-3 bg-panel py-4">
        <Link to="/" title="EnsoCode 工作台" aria-label="EnsoCode 工作台" className="mb-1 flex size-8 items-center justify-center text-surface-foreground">
          <span className="icon-[lucide--circle-dashed] size-[25px]" />
        </Link>
        <button title="收起或展开项目导航" aria-label="收起或展开项目导航" className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-hover" onClick={() => setCompact(!compact)}>
          <span className="icon-[lucide--panel-left] size-[18px]" />
        </button>
        <div className="my-1 w-5 border-t border-border" />
        {rails.map((item) => (
          <Link key={item.label} to={item.to} title={item.label} aria-label={item.label} className={`flex size-9 items-center justify-center ${item.active ? 'text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>
            <span className={`${item.icon} size-[19px]`} />
          </Link>
        ))}
        <button aria-label="打开终端面板" title="终端" className="flex size-9 items-center justify-center rounded-control text-muted hover:bg-hover" onClick={() => { setInspectorOpen(true); setInspectorTab('terminal'); }}>
          <span className="icon-[lucide--square-terminal] size-[19px]" />
        </button>
        <div className="flex-1" />
        <Link to="/settings" title="外观设置" aria-label="外观设置" className={`flex size-9 items-center justify-center rounded-control ${isSettings ? 'bg-control' : 'text-muted hover:bg-hover'}`}>
          <span className="icon-[lucide--settings-2] size-[19px]" />
        </Link>
        <button aria-label="本地工作区信息" title="本地工作区" onClick={() => setNotice('EnsoCode · 本地工作区。这里是独立设计预览，不会读取真实密钥或会话。')} className="mt-1 flex size-8 items-center justify-center rounded-control bg-control text-[12px] font-medium">Y</button>
      </nav>
      {!compact && (
        <aside aria-label={isSettings ? '设置导航' : '项目与会话'} className="flex w-[264px] shrink-0 flex-col bg-sidebar px-3 pb-3 pt-4">
          {isSettings ? (
            <>
              <Link to="/" className="mb-5 flex h-8 items-center gap-2 px-2 text-[13px] text-muted hover:text-surface-foreground">
                <span className="icon-[lucide--arrow-left] size-4" />
                返回工作台
              </Link>
              <h2 className="mb-4 px-2 text-[18px] font-semibold">设置</h2>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {settingsNav.map((group) => (
                  <section className="mb-5" key={group.group}>
                    <h3 className="mb-2 px-2 text-[12px] text-faint">{group.group}</h3>
                    {group.items.map(([label, icon]) => (
                      <button key={label} className={`mb-1 flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-[13px] ${label === '外观' ? 'bg-selected font-medium' : 'text-muted hover:bg-hover'}`} onClick={() => label === '外观' ? undefined : setNotice(`设计预览：本轮展示外观设置；“${label}”保留为后续重构入口。`)}>
                        <span className={`${icon} size-4`} />
                        {label}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex h-9 flex-1 rounded-control bg-control/65 p-[3px]">
                  <button className={`flex-1 rounded-[4px] text-[13px] ${section === 'code' ? 'bg-panel font-medium' : 'text-muted'}`} onClick={() => setSection('code')}>编程</button>
                  <button className={`flex-1 rounded-[4px] text-[13px] ${section === 'team' ? 'bg-panel font-medium' : 'text-muted'}`} onClick={() => { setSection('team'); setNotice('协作视图：在主会话顶部切换“界面实现”和“回归检查”，查看协作 Agent 的交付。'); }}>协作</button>
                </div>
                <button className="flex size-9 items-center justify-center rounded-control bg-control/45 text-muted hover:bg-control" title="搜索会话" aria-label="搜索会话" onClick={() => setSearchOpen(!searchOpen)}>
                  <span className="icon-[lucide--search] size-4" />
                </button>
              </div>
              {searchOpen && <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} aria-label="搜索项目或会话" placeholder="搜索项目或会话…" className="mt-3 h-8 w-full rounded-control border border-border bg-surface px-2 text-[12px] outline-none" />}
              <Link to="/new-task" className="mb-6 mt-4 flex h-9 items-center gap-2 rounded-control px-1.5 hover:bg-hover">
                <span className="icon-[lucide--circle-plus] size-[17px] text-primary" />
                <span className="text-[14px]">新建任务</span>
                <span className="ml-auto rounded border border-border/70 px-1 text-[11px] text-faint">⌘ N</span>
              </Link>
              <div className="mb-3 flex items-center px-2 text-[12px] text-faint">
                <span>{archive ? '已归档会话' : '项目'}</span>
                <button className="ml-auto flex size-5 items-center justify-center rounded hover:bg-hover" aria-label="折叠所有项目" onClick={() => setCollapsed(collapsed.length === projects.length ? [] : projects.map((project) => project.name))}>
                  <span className="icon-[lucide--chevrons-up-down] size-3.5" />
                </button>
                 <Link to="/projects" title="项目管理与添加" aria-label="项目管理与添加" className="ml-2 flex size-5 items-center justify-center rounded hover:bg-hover"><span className="icon-[lucide--plus] size-4" /></Link>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {archive ? <div className="px-2 py-5 text-[12px] leading-6 text-muted">本设计预览暂无归档会话。<button className="block text-primary" onClick={() => setArchive(false)}>返回项目列表</button></div> : projects.filter((project) => !search || `${project.name} ${project.sessions.join(' ')}`.toLowerCase().includes(search.toLowerCase())).map((project) => (
                  <section key={project.name} className="mb-4">
                    <div className="flex h-8 items-center gap-2 px-1.5">
                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setCollapsed(collapsed.includes(project.name) ? collapsed.filter((name) => name !== project.name) : [...collapsed, project.name])} aria-expanded={!collapsed.includes(project.name)}>
                        <span className={`${collapsed.includes(project.name) ? 'icon-[lucide--folder]' : 'icon-[lucide--folder-open]'} size-[17px] shrink-0 text-muted`} />
                        <span className="truncate text-[13px] font-medium">{project.name}</span>
                        {!project.local && <span className="icon-[lucide--wifi] size-3 text-muted" />}
                      </button>
                      <Link to="/new-task" aria-label={`在 ${project.name} 新建任务`} className="flex size-5 items-center justify-center text-faint hover:text-surface-foreground"><span className="icon-[lucide--plus] size-3.5" /></Link>
                    </div>
                    {!collapsed.includes(project.name) && (
                      <div className="ml-3 border-l border-border/60 pl-2">
                        {project.sessions.length ? project.sessions.map((session, index) => (
                          <Link key={session} to={index === 0 ? '/' : '/review'} className={`my-1 flex min-h-[36px] items-center gap-2 rounded-control px-2 text-[12px] ${pathname === '/' && session === projects[0].sessions[0] ? 'bg-selected font-medium text-surface-foreground' : 'text-muted hover:bg-hover'}`}>
                            <span className="min-w-0 flex-1 truncate">{session}</span>
                            {project.name === 'EnsoCode' && index === 0 && <span className="size-[5px] shrink-0 rounded-full bg-success" />}
                          </Link>
                        )) : <p className="px-2 py-2 text-[12px] text-faint">暂无会话</p>}
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <div className="mb-3 flex items-center gap-2 px-2 text-[11px] text-muted">
                <span className="size-[5px] rounded-full bg-success" />
                本机工作区
                <span className="ml-auto">3 个改动</span>
              </div>
              <button className="flex h-8 items-center gap-2 rounded-control px-2 text-[12px] text-muted hover:bg-hover" onClick={() => setArchive(!archive)}>
                <span className="icon-[lucide--archive] size-4" />
                {archive ? '返回项目' : '已归档'}
              </button>
            </>
          )}
        </aside>
      )}
    </>
  );
}

export function Inspector() {
  const { inspectorTab, setInspectorTab, setInspectorOpen, activeFile, setActiveFile } = useWorkbench();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('project');
  const [closedFolders, setClosedFolders] = useState<string[]>(['agent', 'main', 'preload', 'shared', 'docs']);
  const tabs = [{ id: 'files', text: '文件', icon: 'icon-[lucide--folder-open]' }, { id: 'changes', text: '改动', icon: 'icon-[lucide--file-diff]' }, { id: 'terminal', text: '终端', icon: 'icon-[lucide--terminal]' }];
  let hiddenLevel = Infinity;
  const visibleFiles = files.filter((file) => {
    if (file.level <= hiddenLevel) hiddenLevel = Infinity;
    if (file.level > hiddenLevel) return false;
    if (file.folder && closedFolders.includes(file.name)) hiddenLevel = file.level;
    return !query || file.name.toLowerCase().includes(query.toLowerCase());
  });
  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l border-border bg-surface" aria-label="工作区面板">
      <div className="flex h-[43px] shrink-0 items-center gap-1 bg-panel px-2">
        {tabs.map((tab) => (
          <button key={tab.id} className={`flex items-center gap-1.5 rounded-control px-2 py-1.5 text-[12px] ${inspectorTab === tab.id ? 'bg-surface font-medium' : 'text-muted hover:bg-hover'}`} onClick={() => { setInspectorTab(tab.id); setActiveFile(''); }}>
            <span className={`${tab.icon} size-3.5`} />
            {tab.text}
          </button>
        ))}
        <button className="ml-auto flex size-6 items-center justify-center text-muted" title="收起面板" aria-label="收起面板" onClick={() => setInspectorOpen(false)}><span className="icon-[lucide--panel-right-close] size-3.5" /></button>
      </div>
      {inspectorTab === 'files' ? (
        <>
          <label className="mx-3 mb-3 mt-4 flex h-8 items-center gap-2 rounded-control bg-panel px-2 text-muted">
            <span className="icon-[lucide--search] size-3.5" />
            <input aria-label="搜索文件" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件…" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
          </label>
          <div className="mx-3 flex h-8 shrink-0 border-b border-border text-[12px]">
            <button onClick={() => setSource('project')} className={`flex-1 ${source === 'project' ? 'border-b-2 border-primary font-medium' : 'text-muted'}`}>项目文件</button>
            <button onClick={() => setSource('session')} className={`flex-1 ${source === 'session' ? 'border-b-2 border-primary font-medium' : 'text-muted'}`}>会话文件</button>
          </div>
          <p className="mx-4 mb-3 mt-3 text-[11px] leading-5 text-faint">{source === 'project' ? '文件可引用至输入框，为任务提供上下文' : '当前会话产生的交付物与附件'}</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {(source === 'project' ? visibleFiles : [{ name: '重构说明.md', level: 0 }, { name: '界面验收清单.md', level: 0 }]).map((file) => (
              <button key={file.name} onClick={() => file.folder ? setClosedFolders(closedFolders.includes(file.name) ? closedFolders.filter((name) => name !== file.name) : [...closedFolders, file.name]) : setActiveFile(activeFile === file.name ? '' : file.name)} className={`flex h-[30px] w-full items-center gap-1.5 rounded-control pr-2 text-left text-[12px] ${activeFile === file.name ? 'bg-selected' : 'hover:bg-hover'}`} style={{ paddingLeft: 8 + file.level * 12 }}>
                {file.folder ? <span className={`${closedFolders.includes(file.name) ? 'icon-[lucide--chevron-right]' : 'icon-[lucide--chevron-down]'} size-3 shrink-0 text-faint`} /> : <span className="w-3 shrink-0" />}
                <span className={`${file.folder ? 'icon-[lucide--folder] text-faint' : file.name.endsWith('.tsx') ? 'icon-[lucide--file-code-2] text-primary' : 'icon-[lucide--file-text] text-muted'} size-[14px] shrink-0`} />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {'modified' in file && file.modified && <span className="text-[11px] text-warning">M</span>}
              </button>
            ))}
            {source === 'project' && !visibleFiles.length && <p className="p-4 text-[12px] text-muted">没有匹配的文件。</p>}
          </div>
          {activeFile && (
            <div className="mx-3 mb-3 rounded-control border border-border bg-input p-3">
              <div className="mb-2 flex items-center justify-between text-[12px] font-medium"><span>{activeFile}</span><button aria-label="关闭文件预览" onClick={() => setActiveFile('')}><span className="icon-[lucide--x] size-3" /></button></div>
              <pre className="overflow-auto text-[11px] leading-5 text-muted">{activeFile.endsWith('.css') ? ':root {\n  --radius: 6px;\n  --content-area: 205 30% 97%;\n}' : '// 文件内容示例\n// 在完整应用中打开编辑器\nexport default Workbench;'}</pre>
            </div>
          )}
          <div className="mx-4 mb-4 mt-3 border-t border-line pt-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted"><span className="icon-[lucide--git-branch] size-3" />main <span className="ml-auto">本地项目</span></div>
          </div>
        </>
      ) : inspectorTab === 'changes' ? (
        <>
          <div className="px-4 pb-4 pt-5"><h2 className="text-[13px] font-medium">会话改动</h2><p className="mt-1 text-[12px] text-muted">{changes.length} 个文件 <span className="ml-2 text-success">+{added}</span> <span className="text-danger">−{removed}</span></p></div>
          {changes.map((file) => (
            <Link to="/review" key={file.name} className="mx-2 flex gap-2 rounded-control px-2 py-3 hover:bg-hover">
              <span className="icon-[lucide--file-code-2] mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1"><span className="block text-[12px]">{file.name}</span><span className="block truncate text-[11px] text-muted">{file.folder}</span></span>
              <span className="whitespace-nowrap text-[11px]"><span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span></span>
            </Link>
          ))}
          <Link to="/review" className="mx-4 mt-6 flex h-8 items-center justify-center gap-2 rounded-control border border-border text-[12px] hover:bg-hover">打开改动审查<span className="icon-[lucide--arrow-up-right] size-3" /></Link>
          <p className="mx-4 mt-auto pb-4 pt-5 text-[11px] leading-5 text-faint">改动为设计示例，不代表工作区真实状态。</p>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div className="mb-4 flex items-center gap-2 text-[12px]"><span className="size-[5px] rounded-full bg-success" />工作区终端<span className="ml-auto text-[11px] text-faint">只读示例</span></div>
          <pre className="whitespace-pre-wrap text-[11px] leading-[22px] text-muted">{'~/EnsoCode  main\n\n$ pnpm typecheck\n类型检查通过\n\n$ pnpm lint\n代码风格检查通过\n\n$ pnpm test\n测试完成\n\n以上为演示输出，未执行真实命令。\n\n$ ▎'}</pre>
        </div>
      )}
    </aside>
  );
}

export function Notice() {
  const { notice, setNotice } = useWorkbench();
  if (!notice) return null;
  return (
    <div className="absolute bottom-9 left-1/2 z-50 flex w-[520px] max-w-[80%] -translate-x-1/2 items-start gap-3 rounded-control border border-border bg-white p-4 text-[13px] leading-6" role="status">
      <span className="icon-[lucide--info] mt-1 size-4 shrink-0 text-primary" />
      <p className="flex-1">{notice}</p>
      <button aria-label="关闭提示" className="mt-1 text-muted" onClick={() => setNotice('')}><span className="icon-[lucide--x] size-4" /></button>
    </div>
  );
}
