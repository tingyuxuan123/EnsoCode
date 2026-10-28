import { useEffect, useState } from 'react';
import { approvalModes } from './data';
import { MenuItem, MenuPanel, Spinner, useDismiss } from './Controls';
import { useWorkbench } from './Workbench';

/** 输入框上方的运行条（chat/*Bar.tsx）共用外观：细边、浅底，状态只落在图标与小点上 */
const BAR = 'mb-1.5 rounded-control border border-border/70 bg-panel/45 px-3 py-2 text-[12px]';
const tag = 'shrink-0 text-[11px] font-medium text-muted';

function Countdown({ seconds, expired }: { seconds: number; expired: string }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  if (left <= 0) return <span className="shrink-0 text-[11px] text-danger">{expired}</span>;
  return <span className="shrink-0 text-[11px] tabular-nums text-faint">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>;
}

type Approval = { id: string; kind: 'command' | 'file-edit' | 'file-write' | 'mcp'; tool: string; summary: string; protected?: string; reviewing?: boolean; expiresIn: number; sandbox?: boolean };
const approvalQueue: Approval[] = [
  { id: 'a1', kind: 'command', tool: 'bash', summary: 'pnpm typecheck && pnpm lint && pnpm test', expiresIn: 268 },
  { id: 'a2', kind: 'file-write', tool: 'write', summary: '~/.ssh/config', protected: '受保护：密钥', expiresIn: 268 },
  { id: 'a3', kind: 'mcp', tool: 'github › create_pull_request', summary: '{ "title": "统一工作台布局", "base": "main" }', reviewing: true, expiresIn: 268, sandbox: true },
  { id: 'a4', kind: 'command', tool: 'bash', summary: 'rm -rf dist && pnpm build', expiresIn: 0 },
];
const kindIcon = { command: 'icon-[lucide--square-terminal]', 'file-edit': 'icon-[lucide--file-pen]', 'file-write': 'icon-[lucide--file-plus]', mcp: 'icon-[lucide--plug]' };

/** 工具审批（ApprovalBar）：只渲染队首，>1 显示 1/N；受保护操作不提供「本会话总是允许」；代审中隐藏按钮；超时默认拒绝 */
export function ApprovalBar({ allowSession = true, onDone }: { allowSession?: boolean; onDone?: () => void }) {
  const [queue, setQueue] = useState(approvalQueue);
  const active = queue[0];
  if (!active) return null;
  const next = () => { const rest = queue.slice(1); setQueue(rest); if (!rest.length) onDone?.(); };
  const expired = active.expiresIn <= 0;
  return (
    <div className={BAR} role="region" aria-label="需要审批">
      <div className="flex items-center gap-2">
        <span className="icon-[lucide--shield-alert] size-3.5 shrink-0 text-warning" />
        <span className={tag}>{active.reviewing ? '代审中…' : '需要审批'}</span>
        <span className="flex min-w-0 items-center gap-1 text-muted">
          <span className={`${kindIcon[active.kind]} size-3.5 shrink-0`} />
          <span className="truncate font-mono">{active.sandbox ? `隔离沙箱 › ${active.tool}` : active.tool}</span>
        </span>
        {active.protected && <span className="shrink-0 rounded-[4px] bg-danger-soft px-1.5 text-[11px] text-danger">{active.protected}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Countdown key={active.id} seconds={active.expiresIn} expired="已超时拒绝" />
          {queue.length > 1 && <span className="text-[11px] tabular-nums text-faint">1/{queue.length}</span>}
        </span>
      </div>
      <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap rounded-[4px] bg-code px-2 py-1.5 font-mono text-[12px] leading-5">{active.summary}</pre>
      {active.reviewing ? (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted"><Spinner className="size-3" />审批助手正在审查这一步；审完后自动放行或转交给你。<button onClick={next} className="ml-auto text-primary">下一条</button></p>
      ) : (
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {active.protected && <span className="mr-auto text-[11px] text-muted">受保护操作只能单次授权；拒绝不会中止会话。</span>}
          <button disabled={expired} onClick={next} className="rounded-control px-2.5 py-1 text-[12px] text-danger hover:bg-danger-soft disabled:opacity-50">拒绝</button>
          {allowSession && !active.protected && <button disabled={expired} onClick={next} className="rounded-control px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-surface-foreground disabled:opacity-50">本会话总是允许</button>}
          <button disabled={expired} onClick={next} className="rounded-control bg-primary px-2.5 py-1 text-[12px] text-primary-foreground hover:opacity-90 disabled:opacity-50">允许</button>
          {expired && <button onClick={next} className="text-[11px] text-primary">关闭</button>}
        </div>
      )}
    </div>
  );
}

/** Agent 提问（AskBar）：选项一键答或自由输入；提交中 / 超时禁用 */
export function AskBar({ onDone }: { onDone?: () => void }) {
  const asks = [
    { id: 'q1', question: '这次改动使用哪个工作区？主工作树里还有你未提交的改动。', options: ['当前工作树', '新建隔离 worktree', '先检查未提交改动'], expiresIn: 590 },
    { id: 'q2', question: '状态栏的默认字段要不要包含「额度」？它会定时请求厂商额度接口。', options: ['不包含', '包含'], expiresIn: 0 },
  ];
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState('');
  const active = asks[index];
  if (!active) return null;
  const expired = active.expiresIn <= 0;
  const disabled = Boolean(sending) || expired;
  const answer = (value: string) => {
    if (!value.trim()) return;
    setSending(value);
    window.setTimeout(() => { setSending(''); setText(''); if (index + 1 >= asks.length) onDone?.(); setIndex(index + 1); }, 900);
  };
  return (
    <div className={BAR} role="region" aria-label="Agent 提问">
      <div className="flex items-start gap-2">
        <span className="icon-[lucide--message-circle-question] mt-0.5 size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-5">{active.question}</span>
        <Countdown key={active.id} seconds={active.expiresIn} expired="已超时未回答" />
        {asks.length - index > 1 && <span className="shrink-0 text-[11px] tabular-nums text-faint">1/{asks.length - index}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {active.options.map((option) => (
          <button key={option} disabled={disabled} onClick={() => answer(option)} className={`rounded-control border px-2.5 py-1 text-[12px] disabled:opacity-50 ${sending === option ? 'border-primary/50 bg-primary-soft text-primary' : 'border-border/70 text-muted hover:bg-hover hover:text-surface-foreground'}`}>{option}</button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) answer(text); }} placeholder="输入回答…" aria-label="输入回答" className="h-7 min-w-0 flex-1 rounded-control border border-border bg-surface px-2 text-[12px] outline-none focus:border-primary/60 disabled:opacity-50" />
        <button aria-label="发送回答" disabled={disabled || !text.trim()} onClick={() => answer(text)} className="flex size-7 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover disabled:opacity-40">{sending ? <Spinner /> : <span className="icon-[lucide--send] size-3.5" />}</button>
      </div>
      {expired && <p className="mt-1.5 text-[11px] text-muted">请求已过期，Agent 按「未回答」继续；可在输入框补充说明。<button onClick={() => setIndex(index + 1)} className="ml-2 text-primary">关闭</button></p>}
    </div>
  );
}

const plan = {
  title: '设置页导航与分组重构',
  sections: [
    { h: '范围', body: ['只改 renderer/components/settings 的导航与布局，不动 settings store、IPC 与持久化格式。'] },
    { h: '步骤', body: ['盘点 21 个分类的显隐条件（记忆 / 工作流跟随内置工具，Bot 页跟随实验开关）。', '抽出 SettingsNav 与 SettingsSection，统一标题行与 data-settings-row 深链。', '逐页替换布局，保留每一页已有控件与校验。', '补充 settingsCategories 的单元测试，跑 typecheck / lint / test。'] },
    { h: '验收', body: ['深链 `<分类>.root` 仍能定位并闪烁；隐藏分类落到「内置工具」或「实验功能」。'] },
  ],
};

/** 计划模式（PlanBar）：待审批（展开预览 / 修改意见 / 放弃 / 批准并选择执行档位）→ 执行中 → 结束 */
export function PlanBar({ initial = 'review' }: { initial?: 'review' | 'executing' | 'undelivered' }) {
  const { approval, setApproval, setPlanMode } = useWorkbench();
  const [phase, setPhase] = useState<'review' | 'executing' | 'undelivered' | 'done'>(initial);
  const [expanded, setExpanded] = useState(initial === 'review');
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useDismiss<HTMLDivElement>(modeOpen, () => setModeOpen(false));
  if (phase === 'done') return null;
  const preview = (
    <div className="mt-2 max-h-[190px] overflow-y-auto rounded-[4px] border border-line bg-surface px-3 py-2 text-[12px] leading-6">
      {plan.sections.map((section) => (
        <div key={section.h} className="mb-1.5">
          <p className="font-medium">{section.h}</p>
          <ul className="list-disc pl-4 text-muted">{section.body.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ))}
    </div>
  );
  if (phase === 'executing') {
    return (
      <div className={`${BAR} py-1.5`}>
        <div className="flex items-center gap-2">
          <span className="icon-[lucide--clipboard-check] size-3.5 shrink-0 text-muted" />
          <span className="shrink-0 text-muted">执行计划</span>
          <button onClick={() => setExpanded(!expanded)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
            <span className="truncate">{plan.title}</span>
            <span className={`icon-[lucide--chevron-right] size-3 shrink-0 ${expanded ? 'rotate-90' : ''}`} />
          </button>
          <span className="shrink-0 text-[11px] text-faint">按「{approvalModes.find((mode) => mode.id === approval)?.label}」执行</span>
          <button title="结束计划" aria-label="结束计划" onClick={() => { setPhase('done'); setPlanMode(false); }} className="flex size-5 items-center justify-center rounded text-muted hover:text-surface-foreground"><span className="icon-[lucide--x] size-3.5" /></button>
        </div>
        {expanded && preview}
      </div>
    );
  }
  return (
    <div className={BAR} role="region" aria-label="计划待审批">
      <div className="flex items-center gap-2">
        <span className="icon-[lucide--clipboard-list] size-3.5 shrink-0 text-primary" />
        <span className={tag}>{phase === 'undelivered' ? '计划审批未送达' : '计划待审批'}</span>
        <button onClick={() => setExpanded(!expanded)} className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium">
          <span className="truncate">{plan.title}</span>
          <span className={`icon-[lucide--chevron-right] size-3 shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {phase === 'undelivered' && <p className="mt-1.5 text-[11px] text-danger">会话已结束，审批结果没有送达。重新打开会话后再批准，或放弃计划。</p>}
      {expanded && preview}
      {revising && <textarea autoFocus value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="这份计划需要怎么改？（⌘Enter 发送）" aria-label="修改意见" className="mt-2 min-h-16 w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-primary/60" />}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button onClick={() => { setPhase('done'); setPlanMode(false); }} className="rounded-control px-2.5 py-1 text-[12px] text-danger hover:bg-danger-soft">放弃并退出 Plan</button>
        {revising ? (
          <button disabled={!feedback.trim()} onClick={() => { setRevising(false); setFeedback(''); }} className="rounded-control px-2.5 py-1 text-[12px] hover:bg-hover disabled:opacity-50">发送修改意见</button>
        ) : (
          <button onClick={() => setRevising(true)} className="rounded-control px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-surface-foreground">修改意见</button>
        )}
        <div ref={modeRef} className="relative flex">
          <button disabled={phase === 'undelivered'} onClick={() => setPhase('executing')} title={approvalModes.find((mode) => mode.id === approval)?.label} className="rounded-l-control bg-primary px-2.5 py-1 text-[12px] text-primary-foreground hover:opacity-90 disabled:opacity-50">批准并执行</button>
          <button disabled={phase === 'undelivered'} aria-label="选择执行时的审批档位" onClick={() => setModeOpen(!modeOpen)} className="flex items-center rounded-r-control border-l border-white/25 bg-primary px-1 text-primary-foreground disabled:opacity-50"><span className="icon-[lucide--chevron-down] size-3.5" /></button>
          {modeOpen && (
            <MenuPanel label="批准后按以下审批档位执行" className="bottom-8 right-0 w-80">
              <p className="px-2 pb-1.5 pt-1 text-[11px] text-muted">批准后按以下审批档位执行</p>
              {approvalModes.map((mode) => <MenuItem key={mode.id} icon={mode.icon} label={mode.label} hint={mode.id === 'assistant' ? '请先在设置里选择助手代审模型' : mode.desc} disabled={mode.id === 'assistant'} checked={mode.id === approval} onClick={() => { setApproval(mode.id); setModeOpen(false); setPhase('executing'); }} />)}
            </MenuPanel>
          )}
        </div>
      </div>
    </div>
  );
}

/** 插话队列（MessageQueue）：撤回 / 编辑 / 立即发送 / 打断并立即发送 / 移除；附件数 */
export function MessageQueue({ initial }: { initial?: { id: string; text: string; images?: number }[] }) {
  const [queue, setQueue] = useState(initial ?? [
    { id: 'm1', text: '补充检查小窗口宽度下的输入区换行。', images: 0 },
    { id: 'm2', text: '保留现有快捷键，不修改运行逻辑。', images: 2 },
  ]);
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  if (!queue.length) return null;
  const remove = (id: string) => setQueue(queue.filter((item) => item.id !== id));
  return (
    <div className="mb-1.5 rounded-control border border-border/70 bg-panel/45 px-2 py-1 text-[12px]" aria-label="排队消息">
      {queue.map((message) => (
        <div key={message.id} className="flex h-7 items-center gap-2">
          <span className="shrink-0 text-[11px] text-faint">排队</span>
          {editing === message.id ? (
            <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setQueue(queue.map((item) => item.id === message.id ? { ...item, text: draft } : item)); setEditing(''); } if (event.key === 'Escape') setEditing(''); }} aria-label="编辑排队消息" className="h-6 min-w-0 flex-1 rounded-[4px] border border-border bg-surface px-1.5 outline-none" />
          ) : (
            <span className="min-w-0 flex-1 truncate">{message.text}</span>
          )}
          {Boolean(message.images) && <span title={`${message.images} 个附件`} className="flex shrink-0 items-center gap-0.5 text-muted"><span className="icon-[lucide--images] size-3" />{message.images}</span>}
          {editing === message.id ? (
            <button title="保存" onClick={() => { setQueue(queue.map((item) => item.id === message.id ? { ...item, text: draft } : item)); setEditing(''); }} className="rounded p-0.5 text-muted hover:text-surface-foreground"><span className="icon-[lucide--check] size-3.5" /></button>
          ) : (
            <span className="flex shrink-0 items-center gap-0.5 text-muted">
              <button title="撤回" aria-label="撤回" onClick={() => remove(message.id)} className="rounded p-0.5 hover:text-surface-foreground"><span className="icon-[lucide--undo-2] size-3" /></button>
              <button title="编辑" aria-label="编辑" onClick={() => { setEditing(message.id); setDraft(message.text); }} className="rounded p-0.5 hover:text-surface-foreground"><span className="icon-[lucide--pencil] size-3" /></button>
              <button title="立即发送" aria-label="立即发送" onClick={() => remove(message.id)} className="rounded p-0.5 hover:text-surface-foreground"><span className="icon-[lucide--send] size-3" /></button>
              <button title="打断并立即发送" aria-label="打断并立即发送" onClick={() => remove(message.id)} className="rounded p-0.5 hover:text-surface-foreground"><span className="icon-[lucide--square-x] size-3" /></button>
              <button title="移除" aria-label="移除" onClick={() => remove(message.id)} className="rounded p-0.5 hover:text-danger"><span className="icon-[lucide--x] size-3.5" /></button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const goalStatus = { active: { label: '推进中', dot: 'bg-success' }, paused: { label: '已暂停', dot: 'bg-warning' }, waiting: { label: '等待中', dot: 'bg-warning' }, blocked: { label: '受阻', dot: 'bg-danger' }, completed: { label: '已完成', dot: 'bg-primary' } };
type GoalState = keyof typeof goalStatus;

/** 自主目标（GoalBar）：目标 + 备注 + 状态/轮次 + 暂停/继续/清除；/goal 命令设置 */
export function GoalBar({ initial = 'active' }: { initial?: GoalState }) {
  const [status, setStatus] = useState<GoalState>(initial);
  const [cleared, setCleared] = useState(false);
  if (cleared) return null;
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-control border border-border/70 bg-panel/45 px-3 py-1.5 text-[12px]">
      <span className="icon-[lucide--target] size-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate" title="统一工作台布局并完成界面验收">
        统一工作台布局并完成界面验收
        {status === 'blocked' && <span className="text-muted"> — 需要你确认 worktree 策略</span>}
        {status === 'waiting' && <span className="text-muted"> — 等待后台测试结束</span>}
      </span>
      <span className={`size-1.5 shrink-0 rounded-full ${goalStatus[status].dot}`} />
      <span className="shrink-0 text-[11px] tabular-nums text-muted">{goalStatus[status].label}{status === 'active' ? ' · 4/25' : ''}</span>
      {status === 'active' ? (
        <button title="暂停目标" onClick={() => setStatus('paused')} className="rounded p-0.5 text-muted hover:text-surface-foreground"><span className="icon-[lucide--pause] size-3.5" /></button>
      ) : status !== 'completed' ? (
        <button title="继续目标" onClick={() => setStatus('active')} className="rounded p-0.5 text-muted hover:text-surface-foreground"><span className="icon-[lucide--play] size-3.5" /></button>
      ) : null}
      <button title="清除目标" onClick={() => setCleared(true)} className="rounded p-0.5 text-muted hover:text-danger"><span className="icon-[lucide--x] size-3.5" /></button>
    </div>
  );
}

/** 项目扩展信任（ProjectCodeTrustBar）：仓库带 pi 扩展代码时阻止加载，信任后新会话加载 */
export function TrustBar() {
  const [state, setState] = useState<'ask' | 'trusted' | 'hidden'>('ask');
  if (state === 'hidden') return null;
  return (
    <div className="mb-1.5 flex items-start gap-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[12px]">
      <span className="icon-[lucide--shield-question] mt-0.5 size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 leading-5">{state === 'ask' ? '此项目带有 pi 扩展代码，会以你的权限运行，已阻止加载。只有信任这个仓库时才加载。' : '已信任项目扩展，新会话和本会话重新启动后加载。可在项目设置中撤销信任。'}</span>
      {state === 'ask' ? (
        <>
          <button onClick={() => setState('hidden')} className="shrink-0 px-2 py-0.5 text-muted hover:text-surface-foreground">忽略</button>
          <button onClick={() => setState('trusted')} className="shrink-0 rounded-control bg-surface-foreground px-2.5 py-0.5 text-surface">信任并加载</button>
        </>
      ) : (
        <button onClick={() => setState('hidden')} className="shrink-0 text-muted"><span className="icon-[lucide--x] size-3.5" /></button>
      )}
    </div>
  );
}

/** 瞬态错误自动重试（RetryBar） */
export function RetryBar() {
  const [left, setLeft] = useState(8);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (cancelled || left <= 0) return;
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left, cancelled]);
  if (cancelled) return null;
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-control border border-border/70 bg-panel/45 px-3 py-1.5 text-[12px]">
      <span className="icon-[lucide--rotate-cw] size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">自动重试中 (2/5) · 429 Too Many Requests</span>
      <span className="shrink-0 tabular-nums text-muted">{left > 0 ? `${left}s 后重试` : '正在重试…'}</span>
      <button onClick={() => setCancelled(true)} className="shrink-0 text-muted hover:text-surface-foreground">取消自动重试</button>
    </div>
  );
}

/** 回退 / 恢复文件中（ChatView rewinding） */
export function RewindStatus({ files = true }: { files?: boolean }) {
  return (
    <div role="status" className="mb-1.5 flex items-center gap-2 rounded-control border border-border/70 px-3 py-1.5 text-[12px] text-muted">
      <Spinner />
      {files ? '正在回退对话并还原文件…' : '正在回退…'}
    </div>
  );
}

/** 没有可用模型时的阻断提示 */
export function ModelBlock({ reason = 'pick' }: { reason?: 'pick' | 'none' | 'oauth' }) {
  const text = reason === 'none' ? '没有可用模型。请先配置提供商凭证并启用模型。' : reason === 'oauth' ? '订阅凭证仍在加载。可先选择 API Key 模型，或稍候再试。' : '发送前请为本会话选择模型，或设置项目、分组或全局默认模型。';
  return <div role="status" className="mb-1.5 rounded-control border border-dashed border-border px-3 py-2 text-[12px] text-muted">{text}</div>;
}
