import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Link } from 'react-router';
import { StatusDot, inputClass } from '../Controls';
import { groups, projects } from '../data';

/**
 * 远程节点（nodes/RemoteNodeView.tsx + RemoteNodeSidebar + RemoteNodeChat）。
 * 整块换成对方的目录与会话：agent、密钥与历史都留在对方机器上；本机侧栏/对话/右侧面板卸载。
 * 顶部一条状态说明连接方式与同步情况；对方桌面离线时只能看不能发。
 */
export function RemoteShell() {
  const { pathname } = useLocation();
  const offline = pathname.includes('offline');
  const [folded, setFolded] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const list = projects.filter((project) => !search || project.name.includes(search));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={`flex h-8 shrink-0 items-center gap-2 px-4 text-[11px] ${offline ? 'bg-warning-soft text-surface-foreground' : 'bg-panel text-muted'}`}>
        <span className={`size-1.5 rounded-full ${offline ? 'bg-warning' : 'bg-success'}`} />
        <span>{offline ? '对方桌面离线 · 只读，操作会排队等你重连' : '已连接 工作室 Mac mini · 直连 · 同步中…'}</span>
        <span className="ml-auto">agent、密钥与历史都留在对方机器上</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="远程项目与会话" className="flex w-[264px] shrink-0 flex-col border-t border-line bg-sidebar">
          <div className="shrink-0 px-3 pt-3">
            <button className="flex h-9 w-full items-center justify-center gap-1.5 rounded-control bg-control/55 text-[13px] hover:bg-control"><span className="icon-[lucide--plus] size-3.5 text-primary" />新建远程会话</button>
          </div>
          <div className="mt-3 shrink-0 px-3">
            <label className="flex h-8 items-center gap-2 rounded-control bg-control/45 px-2.5 text-muted">
              <span className="icon-[lucide--search] size-3.5" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会话..." aria-label="搜索远程会话" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
            </label>
          </div>
          <div className="mt-3 flex shrink-0 items-center gap-1 px-3 text-[11px]">
            {['全部', '未分组', '已置顶'].map((chip, index) => <span key={chip} className={`rounded-full px-2 py-0.5 ${index === 0 ? 'bg-surface-foreground text-surface' : 'bg-control/50 text-muted'}`}>{chip}</span>)}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {list.length ? list.map((project) => (
              <section key={project.id}>
                <button onClick={() => setFolded(folded.includes(project.id) ? folded.filter((id) => id !== project.id) : [...folded, project.id])} className="flex h-8 w-full items-center gap-2 px-1.5 text-left">
                  <span className={`${folded.includes(project.id) ? 'icon-[lucide--folder-git-2]' : 'icon-[lucide--folder-open]'} size-4 text-muted`} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{project.name}</span>
                </button>
                {!folded.includes(project.id) && (
                  <div className="ml-3 border-l border-border/60 pl-2">
                    {project.sessions.length ? project.sessions.map((session) => (
                      <Link key={session.id} to={offline ? '/remote-offline' : '/remote-node'} className="my-0.5 flex min-h-8 items-center gap-2 rounded-control px-2 text-[12px] text-muted hover:bg-hover">
                        <StatusDot tone={session.dot} />
                        <span className="min-w-0 flex-1 truncate">{session.title}</span>
                      </Link>
                    )) : <p className="px-2 py-1.5 text-[12px] text-faint">没有会话</p>}
                  </div>
                )}
              </section>
            )) : <p className="px-2 py-6 text-center text-[12px] text-muted">对方桌面还没有项目</p>}
            {groups.length > 0 && <div className="pt-1 text-[11px] text-faint">其他 · {groups.length} 个分组</div>}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><span className="icon-[lucide--monitor] size-3.5" />工作室 Mac mini</span>
            <Link to="/" className="text-[11px] text-primary">回到本机</Link>
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-t border-line bg-surface">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** 新建远程会话弹窗用到的字段说明（由 frames/remote-new-session.tsx 复用） */
export const remoteField = inputClass;
