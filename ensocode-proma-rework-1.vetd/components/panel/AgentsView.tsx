import { useState } from 'react';
import { Spinner } from '../Controls';
import { useReadPanelPreset } from './preset';
import { DashedState, PreviewStates, Toolbar } from './PanelUI';

type Status = 'spawning' | 'running' | 'waiting' | 'review' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'queued';
const entries: { id: string; title: string; type: string; mode: 'task' | 'coworker'; origin: string; model: string; status: Status; duration: string; need?: string }[] = [
  { id: 'a1', title: '盘点设置页 21 个分类与显隐条件', type: 'scout', mode: 'task', origin: '模型派发', model: 'Gemini 2.5 Flash', status: 'running', duration: '1分12秒' },
  { id: 'a2', title: '审查侧栏改动', type: 'reviewer', mode: 'task', origin: '通过提及派发', model: 'Claude Opus 4.1', status: 'completed', duration: '3分16秒' },
  { id: 'a3', title: '确认状态栏字段默认值', type: 'worker', mode: 'task', origin: '模型派发', model: 'GPT-5 Codex', status: 'waiting', duration: '2分03秒', need: '要不要默认勾选「额度」' },
  { id: 'a4', title: '补充 settingsCategories 测试', type: 'tester', mode: 'task', origin: '模型派发', model: 'GPT-5 Codex', status: 'failed', duration: '48秒' },
  { id: 'a5', title: '回归检查', type: 'worker', mode: 'coworker', origin: '手动创建', model: 'Claude Sonnet 4.5', status: 'queued', duration: '12分' },
  { id: 'a6', title: '排查手机端审批页', type: 'scout', mode: 'task', origin: '模型派发', model: 'Gemini 2.5 Pro', status: 'cancelled', duration: '21秒' },
  { id: 'a7', title: '旧 worker 推送行（远程节点）', type: 'worker', mode: 'task', origin: '模型派发', model: '—', status: 'interrupted', duration: '5分' },
];
const statusLabel: Record<Status, string> = { spawning: '启动中', running: '运行中', waiting: '等待输入', review: '验收中', completed: '已成功', failed: '失败', cancelled: '已取消', interrupted: '中断', queued: '排队' };
const statusTone: Record<Status, string> = { spawning: 'text-primary', running: 'text-primary', waiting: 'text-warning', review: 'text-primary', completed: 'text-success', failed: 'text-danger', cancelled: 'text-muted', interrupted: 'text-danger', queued: 'text-muted' };
const filterGroups = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'waiting', label: '等待输入' },
  { id: 'done', label: '已结束' },
];

/**
 * 代理（sidepanel/SubagentDirectoryView.tsx + SubagentSessionView.tsx）。
 * 目录来自持久 child metadata：一次性任务与持久协作者分开标注；点进某个代理只能观察过程，
 * 不能发消息，关闭视图不会停止代理；失败项可重试，排队项等有空闲名额后开始。
 */
export function AgentsView() {
  const preset = useReadPanelPreset<{ state: 'list' | 'detail' | 'empty' | 'waiting' | 'failed' }>('agents');
  const [state, setState] = useState(preset.state ?? 'list');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState('a1');
  if (state === 'empty') {
    return (
      <div className="flex h-full flex-col bg-surface">
        <Toolbar><span className="text-[12px] font-medium">代理</span></Toolbar>
        <DashedState icon="icon-[lucide--bot]">暂无子代理<p className="text-faint">创建子代理后，其会话将显示在这里。</p></DashedState>
      </div>
    );
  }
  const shown = entries.filter((entry) => filter === 'all' || (filter === 'running' ? entry.status === 'running' || entry.status === 'spawning' : filter === 'waiting' ? entry.status === 'waiting' : ['completed', 'failed', 'cancelled', 'interrupted'].includes(entry.status)));
  const active = entries.find((entry) => entry.id === open) ?? entries[0];
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Toolbar>
        {state === 'detail' ? (
          <>
            <button onClick={() => setState('list')} className="flex items-center gap-1 text-[12px] text-muted hover:text-surface-foreground"><span className="icon-[lucide--arrow-left] size-3.5" />返回目录</button>
            <span className="ml-1 truncate text-[11px] text-faint">此处仅用于观察运行过程，不能发送消息。关闭此视图不会停止代理。</span>
          </>
        ) : (
          <>
            <span className="text-[12px] font-medium">代理</span>
            <span className="text-[11px] text-muted">{entries.length} 个</span>
            <div className="ml-auto flex items-center gap-0.5">
              {filterGroups.map((group) => <button key={group.id} onClick={() => setFilter(group.id)} className={`rounded-[4px] px-1.5 py-0.5 text-[11px] ${filter === group.id ? 'bg-control text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>{group.label}</button>)}
            </div>
          </>
        )}
      </Toolbar>
      {state === 'detail' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2 text-[12px]">
              {active.status === 'running' ? <Spinner className="size-3.5" /> : <span className={`${active.status === 'failed' ? 'icon-[lucide--circle-x] text-danger' : 'icon-[lucide--circle-check] text-success'} size-3.5`} />}
              <span className="font-medium">{active.title}</span>
              <span className={`ml-auto ${statusTone[active.status]}`}>{statusLabel[active.status]}</span>
            </div>
            <dl className="mt-1.5 grid grid-cols-[56px_1fr] gap-y-1 text-[11px]">
              <dt className="text-faint">类型</dt><dd className="font-mono">{active.type} · {active.mode === 'coworker' ? '持久协作者' : '一次性任务'}</dd>
              <dt className="text-faint">来源</dt><dd>{active.origin}</dd>
              <dt className="text-faint">模型</dt><dd>{active.model}</dd>
              <dt className="text-faint">用时</dt><dd>{active.duration}</dd>
            </dl>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px] leading-6">
            <p className="text-faint">过程</p>
            <p className="mt-1 rounded-control bg-panel px-2 py-1.5 font-mono text-[11px] leading-5">read src/renderer/components/settings/settingsCategories.ts</p>
            <p className="mt-1 rounded-control bg-panel px-2 py-1.5 font-mono text-[11px] leading-5">grep "isCategoryVisible" (3 hits)</p>
            <p className="mt-2 text-muted">结论：记忆与工作流跟随内置工具开关；Bot 两页跟随实验开关；其余 17 页常显。</p>
            <p className="mt-3 text-faint">最终报告</p>
            <p className="mt-1 text-[13px]">21 个分类的显隐条件已核对，未发现遗漏。提示：隐藏页的深链应落到「内置工具」或「实验功能」。</p>
            <p className="mt-3 border-t border-line pt-2 text-[11px] text-faint">较早的过程详情已清理，最终报告仍然保留。</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {shown.map((entry) => (
            <button key={entry.id} onClick={() => { setOpen(entry.id); setState('detail'); }} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-hover">
              <span className="mt-0.5 shrink-0">{entry.status === 'running' ? <Spinner className="size-3.5" /> : <span className={`${entry.status === 'waiting' ? 'icon-[lucide--message-circle-question] text-warning' : entry.status === 'failed' || entry.status === 'interrupted' ? 'icon-[lucide--circle-x] text-danger' : entry.status === 'queued' ? 'icon-[lucide--clock] text-muted' : entry.status === 'cancelled' ? 'icon-[lucide--ban] text-muted' : 'icon-[lucide--circle-check] text-success'} size-3.5`} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{entry.title}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                  <span className="font-mono">{entry.type}</span>
                  <span className="text-border">·</span>
                  <span>{entry.mode === 'coworker' ? '持久协作者' : '一次性任务'}</span>
                  <span className="text-border">·</span>
                  <span className="truncate">{entry.origin}</span>
                </span>
                {entry.need && <span className="mt-0.5 block truncate text-[11px] text-warning">卡住·缺：{entry.need}</span>}
              </span>
              <span className="shrink-0 text-right text-[11px]">
                <span className={`block ${statusTone[entry.status]}`}>{statusLabel[entry.status]}</span>
                <span className="block text-faint">{entry.duration}</span>
              </span>
            </button>
          ))}
          {!shown.length && <p className="px-3 py-8 text-center text-[12px] text-muted">没有符合筛选的代理。</p>}
        </div>
      )}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line px-2 text-[11px] text-faint">
        <span className="icon-[lucide--info] size-3" />
        代理显示已记录的子会话，不代表完整的执行历史。
      </div>
      <PreviewStates value={state} onChange={(value) => setState(value)} options={[{ value: 'list', label: '目录' }, { value: 'detail', label: '查看过程' }, { value: 'empty', label: '暂无子代理' }]} />
    </div>
  );
}
