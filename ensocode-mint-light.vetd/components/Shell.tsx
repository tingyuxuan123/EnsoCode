import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import mark from '../assets/enso-mark.svg';
import { sessions } from './data';

export type ShellState = {
  sessionId: string;
  setSessionId: (id: string) => void;
  compact: boolean;
  setCompact: (compact: boolean) => void;
};

const railButton = 'grid size-9 shrink-0 place-items-center rounded-control text-quiet hover:bg-inset hover:text-surface-foreground';

function SessionList({ sessionId, setSessionId, compact }: ShellState) {
  const [query, setQuery] = useState('');
  const visible = sessions.filter((session) => `${session.title} ${session.summary} ${session.commit}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <aside className="flex w-[276px] shrink-0 flex-col border-r border-line bg-panel px-4 pb-4 pt-5" aria-label="项目会话">
      <label className="flex h-10 items-center gap-2.5 rounded-full bg-inset px-3.5 text-quiet focus-within:ring-1 focus-within:ring-primary">
        <span className="icon-[lucide--search] size-4 shrink-0" />
        <input className="w-full min-w-0 bg-transparent text-[14px] placeholder:text-quiet focus-visible:outline-none" aria-label="搜索会话" placeholder="搜索会话" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && (
          <button type="button" aria-label="清除搜索" className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-line" onClick={() => setQuery('')}>
            <span className="icon-[lucide--x] size-4" />
          </button>
        )}
      </label>
      <button type="button" className="mt-3 flex h-10 items-center gap-2.5 rounded-control px-3 text-left text-[14px] font-semibold hover:bg-inset" onClick={() => setSessionId('new')}>
        <span className="icon-[lucide--square-pen] size-4 text-primary" />
        新建任务
      </button>
      <div className="mb-2 mt-7 px-3 text-[12px] font-medium text-quiet">项目</div>
      <div className="mb-2 flex h-9 items-center gap-2.5 px-3 text-[14px] font-semibold">
        <span className="icon-[lucide--folder-open] size-4 text-muted" />
        EnsoCode
      </div>
      <ul className="space-y-1.5">
        {visible.map((session) => {
          const active = sessionId === session.id;
          return (
            <li key={session.id}>
              <button type="button" aria-current={active ? 'true' : undefined} onClick={() => setSessionId(session.id)} className={`relative flex w-full items-center gap-3 rounded-[16px] px-3 text-left ${compact ? 'min-h-[56px] py-2' : 'min-h-[68px] py-2.5'} ${active ? 'bg-surface shadow-selection' : 'hover:bg-inset'}`}>
                {active && <span aria-hidden="true" className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r-full bg-signal" />}
                <span className={`grid size-9 shrink-0 place-items-center rounded-full ${active ? 'bg-mint text-primary' : 'bg-inset text-quiet'}`}>
                  <span className={`${session.icon} size-4`} />
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-[14px] font-semibold ${active ? 'text-primary' : 'text-surface-foreground'}`}>{session.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-quiet">{session.summary}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p className="px-3 py-5 text-[14px] text-muted">没有匹配的会话。</p>}
      <div className="mt-auto flex items-center gap-2 px-3 pt-4 text-[12px] text-quiet">
        <span className="icon-[lucide--laptop] size-4" />
        本机项目
      </div>
    </aside>
  );
}

function AppearanceNav() {
  return (
    <aside className="flex w-[276px] shrink-0 flex-col border-r border-line bg-panel px-4 pt-5" aria-label="主题预览导航">
      <Link to="/" className="flex h-10 items-center gap-2.5 rounded-control px-3 text-[14px] text-muted hover:bg-inset">
        <span className="icon-[lucide--arrow-left] size-4" />
        返回工作台
      </Link>
      <div className="mb-2 mt-7 px-3 text-[12px] text-quiet">主题预览</div>
      <div className="flex min-h-[56px] items-center gap-3 rounded-[16px] bg-surface px-3 text-[14px] font-semibold text-primary shadow-selection" aria-current="page">
        <span className="grid size-9 place-items-center rounded-full bg-mint">
          <span className="icon-[lucide--palette] size-4" />
        </span>
        薄荷白
      </div>
    </aside>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const appearance = pathname === '/appearance';
  const [sessionId, setSessionId] = useState('dock');
  const [compact, setCompact] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const state: ShellState = { sessionId, setSessionId, compact, setCompact };

  return (
    <div className="mint-shell flex h-full w-full flex-col bg-field px-8 py-7 font-sans text-surface-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-window">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="size-3 rounded-full bg-traffic-red" />
              <span className="size-3 rounded-full bg-traffic-yellow" />
              <span className="size-3 rounded-full bg-traffic-green" />
            </div>
            <Link to="/" className="flex items-center gap-1.5 rounded-control font-display text-[16px] font-bold">
              <img src={mark} className="size-6" alt="" />
              EnsoCode
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to={appearance ? '/' : '/appearance'} className="flex h-8 items-center gap-1.5 rounded-full bg-panel px-3 text-[12px] font-semibold text-muted hover:bg-inset" aria-label={appearance ? '返回工作台' : '查看薄荷白主题'}>
              <span className={`${appearance ? 'icon-[lucide--panels-top-left]' : 'icon-[lucide--palette]'} size-4`} />
              {appearance ? '工作台' : '薄荷白'}
            </Link>
            <span className="flex h-8 items-center gap-2 rounded-full bg-mint px-3 text-[12px] font-semibold text-primary">
              <span className="size-2 rounded-full bg-signal" />
              本地工作区
            </span>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel py-4" aria-label="工作区工具">
            <Link to="/" className={`${railButton} ${appearance ? '' : 'bg-mint text-primary hover:bg-mint hover:text-primary'}`} aria-label="工作台" title="工作台" aria-current={appearance ? undefined : 'page'}>
              <span className="icon-[lucide--terminal] size-5" />
            </Link>
            {!appearance && (
              <button type="button" className={railButton} aria-label={sidebarOpen ? '收起项目栏' : '展开项目栏'} title={sidebarOpen ? '收起项目栏' : '展开项目栏'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
                <span className="icon-[lucide--panel-left] size-5" />
              </button>
            )}
            <Link to="/appearance" className={`${railButton} mt-auto ${appearance ? 'bg-mint text-primary hover:bg-mint hover:text-primary' : ''}`} aria-label="外观" title="外观" aria-current={appearance ? 'page' : undefined}>
              <span className="icon-[lucide--settings-2] size-5" />
            </Link>
          </nav>
          {appearance ? <AppearanceNav /> : sidebarOpen && <SessionList {...state} />}
          <Outlet context={state} />
        </div>
      </div>
    </div>
  );
}
