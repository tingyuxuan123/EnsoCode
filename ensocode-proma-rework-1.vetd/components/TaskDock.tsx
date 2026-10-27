import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

export type DockView = 'progress' | 'agents' | null;
const progress = [
  { title: '排查首页及各角色组件的高度与裁切布局', status: 'completed' },
  { title: '统一修复内容自适应及底部遮挡问题', status: 'completed' },
  { title: '执行相关检查并总结修复范围', status: 'running' },
];
const tasks = [
  { id: 'layout', title: '修复采购财务首页自适应布局', description: '统一各角色首页的内容高度，修复文字裁切与底部遮挡。', model: 'GPT-5 Codex', status: 'completed', duration: '4分00秒', result: '已整理内容容器的高度约束与滚动边界，采购、财务角色共用一致的自适应规则。', scope: '首页布局 · 组件高度 · 底部留白' },
  { id: 'audit', title: '排查其他角色首页裁切布局', description: '检查首页、角色组件与内容区的布局边界，汇总问题位置。', model: 'Gemini 2.5 Pro', status: 'completed', duration: '3分16秒', result: '问题集中在固定高度容器和嵌套 overflow；已输出问题范围供主会话处理。', scope: '角色首页 · 滚动容器 · 问题清单' },
];
const done = progress.filter((item) => item.status === 'completed').length;
const running = tasks.filter((item) => item.status === 'running').length;
const filters = [{ id: 'recent', label: '最近' }, { id: 'running', label: '进行中' }, { id: 'completed', label: '已完成' }, { id: 'all', label: '全部' }];

export function TaskDock({ initial = null }: { initial?: DockView }) {
  const [view, setView] = useState<DockView>(initial);
  const [filter, setFilter] = useState('recent');
  const [selected, setSelected] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const active = tasks.find((task) => task.id === selected);
  const visible = tasks.filter((task) => filter === 'recent' || filter === 'all' || task.status === filter);
  useEffect(() => {
    if (!view) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setView(null); setSelected(''); }
    };
    const closeOutside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setView(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [view]);
  const close = () => { setView(null); setSelected(''); };
  return (
    <div ref={root} className="relative mx-5 shrink-0">
      {view && (
        <section aria-label={view === 'progress' ? '当前进度面板' : '后台 Agent 面板'} className="absolute bottom-[42px] left-0 right-0 z-30 overflow-hidden rounded-control border border-border bg-surface">
          <header className="flex h-[44px] items-center gap-2 border-b border-line bg-panel/60 px-4">
            <span className={`${view === 'progress' ? 'icon-[lucide--list-checks]' : 'icon-[lucide--bot]'} size-4 shrink-0 text-muted`} />
            <h2 className="whitespace-nowrap text-[13px] font-medium">{view === 'progress' ? '当前进度' : '后台 Agent'}</h2>
            <span className="text-[12px] tabular-nums text-muted">{view === 'progress' ? `${done} / ${progress.length}` : `${running} 个运行中`}</span>
            {view === 'agents' && !active && (
              <div className="ml-auto flex h-7 items-center rounded-control bg-control/45 p-[2px]" role="group" aria-label="筛选后台任务">
                {filters.map((item) => (
                  <button key={item.id} onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`h-full whitespace-nowrap rounded-[4px] px-2 text-[11px] ${filter === item.id ? 'bg-surface text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {view === 'progress' && <span className="ml-auto text-[11px] text-muted">最后一步进行中</span>}
            {active && <button onClick={() => setSelected('')} className="ml-auto text-[11px] text-muted hover:text-surface-foreground">返回列表</button>}
            <button aria-label="收起任务面板" title="收起任务面板" className="ml-2 flex size-6 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover" onClick={close}>
              <span className="icon-[lucide--x] size-3.5" />
            </button>
          </header>
          {view === 'progress' ? (
            <div className="px-4 pb-4 pt-3">
              <div className="mb-3 h-[3px] overflow-hidden rounded-full bg-control" role="progressbar" aria-label="当前任务完成进度" aria-valuenow={done} aria-valuemin={0} aria-valuemax={progress.length}>
                <div className="h-full bg-primary" style={{ width: `${done / progress.length * 100}%` }} />
              </div>
              <ol className="space-y-2.5">
                {progress.map((item) => (
                  <li key={item.title} className="flex items-center gap-2.5 text-[13px] leading-5">
                    <span className={`${item.status === 'completed' ? 'icon-[lucide--check] text-success' : 'icon-[lucide--circle-dot] text-primary'} size-3.5 shrink-0`} />
                    <span className={item.status === 'completed' ? 'text-muted line-through decoration-border' : 'font-medium'}>{item.title}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] text-muted">
                <span className="icon-[lucide--info] size-3" />
                完成后收起清单，结果保留在会话中
                <Link to="/task-progress" className="ml-auto whitespace-nowrap text-primary">查看进度场景</Link>
              </div>
            </div>
          ) : active ? (
            <div className="px-4 py-4">
              <div className="mb-2 flex items-center gap-2"><span className="icon-[lucide--circle-check] size-4 text-success" /><h3 className="text-[14px] font-medium">{active.title}</h3></div>
              <p className="text-[13px] leading-6 text-muted">{active.result}</p>
              <dl className="mt-4 grid grid-cols-[64px_1fr] gap-y-2 text-[12px]">
                <dt className="text-muted">模型</dt><dd>{active.model}</dd>
                <dt className="text-muted">耗时</dt><dd>{active.duration}</dd>
                <dt className="text-muted">任务范围</dt><dd>{active.scope}</dd>
              </dl>
              <p className="mt-4 border-t border-line pt-3 text-[11px] text-muted">示例结果 · 不代表真实执行记录</p>
            </div>
          ) : visible.length ? (
            <div>
              <div className="grid grid-cols-2 divide-x divide-line px-1 py-1">
                {visible.map((task) => (
                  <article key={task.id} className="flex flex-col px-3 py-3">
                    <div className="flex items-start gap-2">
                      <span className="icon-[lucide--circle-check] size-4 shrink-0 text-success" />
                      <h3 className="min-w-0 text-[13px] font-medium leading-5">{task.title}</h3>
                    </div>
                    <p className="mb-3 mt-2 line-clamp-2 text-[12px] leading-5 text-muted">{task.description}</p>
                    <div className="mt-auto flex items-center gap-1.5 text-[11px] text-muted"><span className="icon-[lucide--bot] size-3" />{task.model}</div>
                    <div className="mt-3 flex items-center gap-1.5 text-[11px]"><span className="text-success">已完成</span><span className="ml-auto flex items-center gap-1 text-muted"><span className="icon-[lucide--clock-3] size-3" />{task.duration}</span></div>
                    <button className="mt-3 flex items-center gap-1 self-start whitespace-nowrap text-[11px] text-primary" onClick={() => setSelected(task.id)}>查看交付<span className="icon-[lucide--arrow-up-right] size-3" /></button>
                  </article>
                ))}
              </div>
              <div className="flex items-center border-t border-line px-4 py-2.5 text-[11px] text-muted"><span>{tasks.length} 个一次性任务 · 已全部结束</span><Link to="/background-agents" className="ml-auto text-primary">查看后台任务场景</Link></div>
            </div>
          ) : (
            <div className="flex h-[124px] flex-col items-center justify-center gap-2 text-[12px] text-muted">
              <span className="icon-[lucide--circle-check] size-5 text-faint" />
              <p>没有进行中的后台任务</p>
              <button className="text-[11px] text-primary" onClick={() => setFilter('completed')}>查看已完成任务</button>
            </div>
          )}
        </section>
      )}
      <div className="flex h-[36px] items-center gap-2 text-[12px]">
        <button aria-expanded={view === 'agents'} onClick={() => { setView(view === 'agents' ? null : 'agents'); setSelected(''); }} className={`flex h-7 items-center gap-1.5 whitespace-nowrap rounded-control border px-2.5 ${view === 'agents' ? 'border-border bg-control/65' : 'border-line bg-input text-muted hover:bg-hover'}`}>
          <span className="icon-[lucide--bot] size-3.5" />
          后台 Agent
          <span className="text-[11px] tabular-nums text-muted">{tasks.length}</span>
        </button>
        <button aria-expanded={view === 'progress'} onClick={() => setView(view === 'progress' ? null : 'progress')} className={`flex h-7 items-center gap-1.5 whitespace-nowrap rounded-control border px-2.5 ${view === 'progress' ? 'border-border bg-control/65' : 'border-line bg-input text-muted hover:bg-hover'}`}>
          <span className="icon-[lucide--circle-dot] size-3.5 text-primary" />
          当前进度
          <span className="text-[11px] tabular-nums text-muted">{done}/{progress.length}</span>
        </button>
        <span className="ml-auto text-[11px] text-faint">{running ? `${running} 个后台任务运行中` : '后台任务已完成'}</span>
      </div>
    </div>
  );
}
