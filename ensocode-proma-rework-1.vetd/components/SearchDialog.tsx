import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useDismiss } from './Controls';
import { projects } from './data';
import { useWorkbench } from './Workbench';

type Scope = 'current' | 'all' | 'archived';
const hits = [
  { group: '对话', icon: 'icon-[lucide--messages-square]', title: '统一工作台布局与侧栏样式', meta: 'EnsoCode · 2 分钟前 · 命中 3 处：GroupChips 横滑、侧栏宽度、状态点', badge: '' },
  { group: '对话', icon: 'icon-[lucide--messages-square]', title: '优化文件搜索体验', meta: 'EnsoCode · 1 小时前 · 命中 1 处：搜索面板与内容过滤', badge: 'worktree' },
  { group: '浏览器', icon: 'icon-[lucide--globe]', title: 'Status Line · shadcn/ui', meta: 'ui.shadcn.com/docs/components/status · 之前由 Agent 打开', badge: 'Agent' },
  { group: '设置', icon: 'icon-[lucide--settings-2]', title: '外观 → 背景图 → 输入框不透明度', meta: '设置 · 打开并定位到该行', badge: '' },
  { group: '动作', icon: 'icon-[lucide--command]', title: '新对话', meta: '⌘N', badge: '' },
  { group: '动作', icon: 'icon-[lucide--command]', title: '打开设置', meta: '⌘,', badge: '' },
];

/**
 * 全局搜索（search/WorkspaceSearchDialog.tsx，⌘K）：范围 当前 / 全部 / 已归档，
 * 分组命中（对话正文、浏览器标签、设置项、动作），上下键选择、Enter 打开、Esc 关闭。
 */
export function SearchDialog() {
  const { searchOpen, setSearchOpen } = useWorkbench();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 搜索帧（/search）默认带一个查询词，其余入口从空开始
  const [q, setQ] = useState(pathname === '/search' ? '状态栏' : '');
  const [scope, setScope] = useState<Scope>('current');
  const [active, setActive] = useState(0);
  const ref = useDismiss<HTMLDivElement>(searchOpen, () => setSearchOpen(false));
  if (!searchOpen) return null;
  const groups = [...new Set(hits.map((hit) => hit.group))];
  const open = (title: string) => {
    setSearchOpen(false);
    if (title.includes('外观')) navigate('/settings-appearance');
    else if (title === '新对话') navigate('/new-task');
    else if (title === '打开设置') navigate('/settings-general');
    else navigate('/');
  };
  return (
    <div className="absolute inset-0 z-[70] flex items-start justify-center bg-surface-foreground/10 px-6 pt-[10vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
      <div ref={ref} role="dialog" aria-label="搜索任意内容" className="w-full max-w-[680px] overflow-hidden rounded-control border border-border bg-surface shadow-[0_16px_40px_rgba(20,40,60,0.16)]">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3">
          <span className="icon-[lucide--search] size-4 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearchOpen(false);
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(active + 1, hits.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(active - 1, 0)); }
              if (event.key === 'Enter') open(hits[active]?.title ?? '');
            }}
            placeholder="搜索对话、浏览器标签、设置…"
            aria-label="搜索内容"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <div className="flex h-7 items-center gap-0.5 rounded-control bg-control/50 p-[2px] text-[11px]">
            {([['current', '当前'], ['all', '全部'], ['archived', '已归档']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setScope(id)} className={`h-full rounded-[4px] px-2 ${scope === id ? 'bg-surface font-medium text-surface-foreground' : 'text-muted'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1">
          {q.trim() ? (
            <>
              <p className="px-3 pb-1 pt-1 text-[11px] text-faint">{scope === 'current' ? '当前项目' : scope === 'all' ? '全部项目' : '已归档'} · {hits.length} 条结果</p>
              {groups.map((group) => (
                <section key={group}>
                  <p className="px-3 pb-0.5 pt-1.5 text-[11px] text-faint">{group}</p>
                  {hits.filter((hit) => hit.group === group).map((hit) => {
                    const index = hits.indexOf(hit);
                    return (
                      <button
                        key={hit.title}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => open(hit.title)}
                        className={`flex w-full items-start gap-2.5 px-3 py-2 text-left ${active === index ? 'bg-selected' : 'hover:bg-hover'}`}
                      >
                        <span className={`${hit.icon} mt-0.5 size-4 shrink-0 text-muted`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{hit.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted">{hit.meta}</span>
                        </span>
                        {hit.badge && <span className="shrink-0 rounded-[4px] bg-primary-soft px-1.5 text-[10px] text-primary">{hit.badge}</span>}
                      </button>
                    );
                  })}
                </section>
              ))}
            </>
          ) : (
            <>
              <p className="px-3 pb-1 pt-1.5 text-[11px] text-faint">最近</p>
              {projects.slice(0, 3).map((project) => (
                <button key={project.id} onClick={() => { setSearchOpen(false); navigate('/'); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover">
                  <span className="icon-[lucide--folder-open] size-4 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{project.name}</span>
                  <span className="text-[11px] text-faint">{project.sessions.length} 个对话</span>
                </button>
              ))}
              <p className="px-3 pb-1 pt-2 text-[11px] text-faint">动作</p>
              {hits.filter((hit) => hit.group === '动作').map((hit) => (
                <button key={hit.title} onClick={() => open(hit.title)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover">
                  <span className="icon-[lucide--command] size-4 text-muted" />
                  <span className="flex-1 text-[13px]">{hit.title}</span>
                  <span className="text-[11px] text-faint">{hit.meta}</span>
                </button>
              ))}
            </>
          )}
          {q.trim() && !hits.length && <p className="px-3 py-10 text-center text-[13px] text-muted">没有匹配结果</p>}
        </div>
        <div className="flex h-8 items-center gap-3 border-t border-line px-3 text-[11px] text-faint">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
          <span className="ml-auto">设置项命中会直接跳到对应行并闪烁</span>
        </div>
      </div>
    </div>
  );
}
