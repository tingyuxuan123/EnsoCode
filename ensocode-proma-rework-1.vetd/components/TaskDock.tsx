import { useState, type ReactNode } from 'react';
import { Segmented, Spinner, useDismiss } from './Controls';
import { useWorkbench } from './Workbench';

export type DockView = 'progress' | 'agents' | 'bash' | null;
type Filter = 'recent' | 'running' | 'done' | 'all';

const todos = [
  { title: '盘点设置页 21 个分类与显隐条件', status: 'completed' },
  { title: '统一项目侧栏、对话区与右侧停靠面板', status: 'completed' },
  { title: '补齐运行条与任务栏的所有状态', status: 'in_progress' },
  { title: '执行 typecheck / lint / test 并截图验收', status: 'pending' },
];
const agents = [
  { id: 'ag1', title: '排查设置页布局裁切', type: 'scout', mode: 'task', origin: '模型派发', model: 'Gemini 2.5 Flash', status: 'running', duration: '1分12秒', summary: '正在读取 settings/*.tsx 的滚动容器……' },
  { id: 'ag2', title: '审查侧栏改动', type: 'reviewer', mode: 'task', origin: '通过提及派发', model: 'Claude Opus 4.1', status: 'completed', duration: '3分16秒', summary: '未发现行为回归；建议给 GroupChips 的横滑补一个键盘可达的入口。' },
  { id: 'ag3', title: '补充 settingsCategories 测试', type: 'tester', mode: 'task', origin: '模型派发', model: 'GPT-5 Codex', status: 'failed', duration: '48秒', summary: '测试运行失败：vitest 找不到 jsdom 环境。' },
  { id: 'ag4', title: '回归检查', type: 'worker', mode: 'coworker', origin: '手动创建', model: 'Claude Sonnet 4.5', status: 'standby', duration: '12分', summary: '协作者待命，可继续接收消息。' },
];
const bash = [
  { id: 'b1', command: 'pnpm dev', status: 'running', duration: '18分', tail: 'VITE v7.1.4  ready in 812 ms\n➜  Local:   http://localhost:5173/' },
  { id: 'b2', command: 'pnpm test --watch', status: 'failed', duration: '2分', tail: 'FAIL src/shared/settingsDeepLink.test.ts\n  ✕ resolves hidden category (14 ms)' },
  { id: 'b3', command: 'pnpm typecheck', status: 'completed', duration: '41秒', tail: '类型检查通过' },
];
const statusText: Record<string, string> = { running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', standby: '协作者待命' };
const statusIcon = (status: string) => status === 'running' ? <Spinner className="size-3.5 text-primary" /> : <span className={`${status === 'failed' ? 'icon-[lucide--circle-x] text-danger' : status === 'standby' ? 'icon-[lucide--circle-pause] text-muted' : 'icon-[lucide--circle-check] text-success'} size-3.5 shrink-0`} />;
const match = (status: string, filter: Filter) => filter === 'all' || filter === 'recent' || (filter === 'running' ? status === 'running' : status !== 'running');

function DockButton({ icon, label, running, failed, open, onClick, extra }: { icon: string; label: string; running: number; failed?: boolean; open: boolean; onClick: () => void; extra?: ReactNode }) {
  return (
    <button aria-expanded={open} onClick={onClick} title={running ? `${running} 个运行中` : undefined} className={`relative inline-flex h-7 items-center gap-1.5 rounded-control border border-border/80 px-2.5 text-[12px] ${open ? 'bg-control/70 text-surface-foreground' : 'bg-surface text-muted hover:bg-hover hover:text-surface-foreground'}`}>
      {running ? <Spinner className="size-3.5" /> : <span className={`${icon} size-3.5`} />}
      {label}
      {running > 0 && <span className="tabular-nums">· {running}</span>}
      {extra}
      {failed && <span role="img" aria-label="失败" className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger" />}
    </button>
  );
}

function Panel({ icon, title, count, onClose, children, filter, setFilter, extra }: { icon: string; title: string; count: string; onClose: () => void; children: ReactNode; filter?: Filter; setFilter?: (value: Filter) => void; extra?: ReactNode }) {
  return (
    <section aria-label={title} className="absolute bottom-full left-0 right-0 z-30 mb-1.5 flex max-h-[360px] flex-col overflow-hidden rounded-control border border-border bg-surface shadow-[0_8px_24px_rgba(20,40,60,0.12)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <span className={`${icon} size-3.5 text-muted`} />
        <span className="font-medium">{title}</span>
        <span className="tabular-nums text-muted">{count}</span>
        <span className="ml-auto" />
        {extra}
        {filter && setFilter && <Segmented size="sm" label="筛选" value={filter} onChange={setFilter} options={[{ value: 'recent', label: '最近' }, { value: 'running', label: '进行中' }, { value: 'done', label: '已完成' }, { value: 'all', label: '全部' }]} />}
        <button aria-label="收起" onClick={onClose} className="flex size-6 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--x] size-3.5" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}

/** 输入框上方固定按钮条（chat/TaskBar.tsx）：后台 Bash / 后台 Agent / 当前进度；点开在上方弹出，Esc / 外部点击收起 */
export function TaskDock({ initial = null }: { initial?: DockView }) {
  const { openSideTab } = useWorkbench();
  const [view, setView] = useState<DockView>(initial);
  const [filter, setFilter] = useState<Filter>('running');
  const [detail, setDetail] = useState('');
  const [stopped, setStopped] = useState<string[]>([]);
  const ref = useDismiss<HTMLDivElement>(Boolean(view), () => { setView(null); setDetail(''); });
  const done = todos.filter((item) => item.status === 'completed').length;
  const toggle = (next: DockView) => { setView(view === next ? null : next); setDetail(''); };
  const shownAgents = agents.filter((agent) => match(stopped.includes(agent.id) ? 'cancelled' : agent.status, filter));
  const shownBash = bash.filter((task) => match(stopped.includes(task.id) ? 'cancelled' : task.status, filter));
  const activeAgent = agents.find((agent) => agent.id === detail);
  return (
    <div ref={ref} className="relative mb-1.5">
      {view === 'progress' && (
        <Panel icon="icon-[lucide--list-todo]" title="当前进度" count={`${done}/${todos.length}`} onClose={() => setView(null)}>
          <div className="mb-2 h-[3px] overflow-hidden rounded-full bg-control" role="progressbar" aria-valuenow={done} aria-valuemax={todos.length}><div className="h-full bg-primary" style={{ width: `${(done / todos.length) * 100}%` }} /></div>
          <ol className="space-y-2 px-1">
            {todos.map((item) => (
              <li key={item.title} className="flex items-center gap-2.5 text-[13px] leading-5">
                <span className={`${item.status === 'completed' ? 'icon-[lucide--circle-check] text-success' : item.status === 'in_progress' ? 'icon-[lucide--circle-dot] text-primary' : 'icon-[lucide--circle] text-faint'} size-3.5 shrink-0`} />
                <span className={item.status === 'completed' ? 'text-muted line-through decoration-border' : item.status === 'in_progress' ? 'font-medium' : 'text-muted'}>{item.title}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {view === 'agents' && (
        <Panel icon="icon-[lucide--bot]" title="后台 Agent" count={`${agents.filter((agent) => agent.status === 'running' && !stopped.includes(agent.id)).length} 个运行中`} onClose={() => setView(null)} filter={activeAgent ? undefined : filter} setFilter={setFilter} extra={activeAgent ? <button onClick={() => setDetail('')} className="text-[12px] text-muted hover:text-surface-foreground">返回列表</button> : <button onClick={() => { setView(null); openSideTab('agents'); }} className="text-[12px] text-primary">在侧栏打开</button>}>
          {activeAgent ? (
            <div className="px-2 py-1">
              <div className="flex items-center gap-2">{statusIcon(activeAgent.status)}<h3 className="text-[14px] font-medium">{activeAgent.title}</h3></div>
              <dl className="mt-3 grid grid-cols-[72px_1fr] gap-y-1.5 text-[12px]">
                <dt className="text-muted">类型</dt><dd className="font-mono">{activeAgent.type} · {activeAgent.mode === 'coworker' ? '持久协作者' : '一次性任务'}</dd>
                <dt className="text-muted">来源</dt><dd>{activeAgent.origin}</dd>
                <dt className="text-muted">模型</dt><dd>{activeAgent.model}</dd>
                <dt className="text-muted">用时</dt><dd>{activeAgent.duration}</dd>
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-[11px] text-muted">最终报告</p>
              <p className="mt-1 text-[13px] leading-6">{activeAgent.summary}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => { setView(null); openSideTab('agents'); }} className="rounded-control border border-border px-3 py-1 text-[12px] hover:bg-hover">查看过程</button>
                {activeAgent.status === 'running' && <button onClick={() => setStopped([...stopped, activeAgent.id])} className="rounded-control px-3 py-1 text-[12px] text-danger hover:bg-danger-soft">停止子代理</button>}
              </div>
            </div>
          ) : shownAgents.length ? (
            <div className="grid grid-cols-2 gap-1.5">
              {shownAgents.map((agent) => {
                const status = stopped.includes(agent.id) ? 'cancelled' : agent.status;
                return (
                  <article key={agent.id} className="flex flex-col rounded-control border border-line px-3 py-2.5">
                    <div className="flex items-start gap-2">{statusIcon(status)}<h3 className="min-w-0 flex-1 text-[13px] font-medium leading-5">{agent.title}</h3></div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{agent.summary}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                      <span className="font-mono">{agent.type}</span>·<span>{agent.mode === 'coworker' ? '持久协作者' : '一次性任务'}</span>·<span className="truncate">{agent.model}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px]">
                      <span className={status === 'failed' ? 'text-danger' : status === 'running' ? 'text-primary' : 'text-muted'}>{statusText[status]}</span>
                      <span className="text-faint">{agent.duration}</span>
                      <button onClick={() => setDetail(agent.id)} className="ml-auto text-primary">查看过程</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p className="py-8 text-center text-[12px] text-muted">没有正在运行的任务。</p>}
        </Panel>
      )}
      {view === 'bash' && (
        <Panel icon="icon-[lucide--square-terminal]" title="后台 Bash" count={`${bash.filter((task) => task.status === 'running' && !stopped.includes(task.id)).length} 个运行中`} onClose={() => setView(null)} filter={filter} setFilter={setFilter}>
          {shownBash.length ? shownBash.map((task) => {
            const status = stopped.includes(task.id) ? 'cancelled' : task.status;
            return (
              <article key={task.id} className="mb-1.5 rounded-control border border-line px-3 py-2">
                <div className="flex items-center gap-2 text-[12px]">
                  {statusIcon(status)}
                  <code className="min-w-0 flex-1 truncate bg-transparent p-0 font-mono">{task.command}</code>
                  <span className={status === 'failed' ? 'text-danger' : 'text-muted'}>{statusText[status]}</span>
                  <span className="text-faint">{task.duration}</span>
                  {status === 'running' && <button onClick={() => setStopped([...stopped, task.id])} className="text-danger">停止任务</button>}
                </div>
                <pre className="mt-1.5 max-h-16 overflow-auto rounded-[4px] bg-code px-2 py-1 font-mono text-[11px] leading-5 text-muted">{task.tail || '(暂无输出)'}</pre>
              </article>
            );
          }) : <p className="py-8 text-center text-[12px] text-muted">没有正在运行的任务。</p>}
        </Panel>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <DockButton icon="icon-[lucide--square-terminal]" label="后台 Bash" running={1} failed open={view === 'bash'} onClick={() => toggle('bash')} />
        <DockButton icon="icon-[lucide--bot]" label="后台 Agent" running={1} failed open={view === 'agents'} onClick={() => toggle('agents')} />
        <button aria-expanded={view === 'progress'} onClick={() => toggle('progress')} className={`inline-flex h-7 items-center gap-1.5 rounded-control border border-border/80 px-2.5 text-[12px] ${view === 'progress' ? 'bg-control/70' : 'bg-surface text-muted hover:bg-hover hover:text-surface-foreground'}`}>
          <Spinner className="size-3.5" />
          当前进度
          <span className="tabular-nums">{done}/{todos.length}</span>
        </button>
      </div>
    </div>
  );
}
