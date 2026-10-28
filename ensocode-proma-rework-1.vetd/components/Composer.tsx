import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MenuItem, MenuLabel, MenuPanel, MenuSeparator, Switch, useDismiss } from './Controls';
import { approvalModes, presets, thinkingLevels, vendors, virtualModels } from './data';
import { useWorkbench } from './Workbench';

const pill = 'flex h-7 min-w-0 shrink items-center gap-1 rounded-control px-2 text-[12px] text-muted hover:bg-hover hover:text-surface-foreground';

function Popover({ trigger, children, align = 'left', width = 'w-72', open, setOpen }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right'; width?: string; open: boolean; setOpen: (value: boolean) => void }) {
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative min-w-0">
      {trigger}
      {open && <MenuPanel label="选项" className={`bottom-9 ${align === 'left' ? 'left-0' : 'right-0'} ${width}`}>{children}</MenuPanel>}
    </div>
  );
}

/** 运行时预设：对话开始后锁定 */
export function PresetPicker({ started = false }: { started?: boolean }) {
  const { preset, setPreset } = useWorkbench();
  const [open, setOpen] = useState(false);
  const current = presets.find((item) => item.id === preset) ?? presets[0];
  return (
    <Popover open={open} setOpen={setOpen} trigger={
      <button className={pill} disabled={started} title={started ? '对话开始后预设已锁定，不能中途替换' : '预设'} onClick={() => setOpen(!open)}>
        <span className="icon-[lucide--layers] size-3.5 shrink-0" />
        <span className="truncate">{current.name}</span>
        {started ? <span className="icon-[lucide--lock] size-3 shrink-0" /> : <span className="icon-[lucide--chevron-down] size-3 shrink-0" />}
      </button>
    }>
      <MenuLabel>预设 · 角色描述 / 技能 / MCP / 指令文件的组合</MenuLabel>
      {presets.map((item) => <MenuItem key={item.id} label={item.name} hint={item.desc} checked={item.id === preset} onClick={() => { setPreset(item.id); setOpen(false); }} />)}
      <MenuSeparator />
      <Link to="/settings-presets" className="flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12px] text-muted hover:bg-hover"><span className="icon-[lucide--settings-2] size-3.5" />管理预设</Link>
    </Popover>
  );
}

/** 工作区：本地工作区 / 新建隔离 worktree / 已有 worktree / 本地分支 */
export function WorktreePicker() {
  const { worktree, setWorktree, setNotice } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  return (
    <Popover open={open} setOpen={setOpen} width="w-80" trigger={
      <button className={pill} title="工作区与分支" onClick={() => setOpen(!open)}>
        <span className={`${worktree ? 'icon-[lucide--git-fork]' : 'icon-[lucide--git-branch]'} size-3.5 shrink-0`} />
        <span className="truncate font-mono text-[11px]">{worktree || 'main'}</span>
        <span className="icon-[lucide--chevron-down] size-3 shrink-0" />
      </button>
    }>
      {dirty ? (
        <div className="p-2">
          <p className="text-[13px] font-medium">主工作树有未提交改动</p>
          <p className="mt-1 text-[12px] leading-5 text-muted">新 worktree 从 HEAD 切出，这些改动会留在主工作树，不会跟随本会话。</p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setDirty(false)} className="px-2 py-1 text-[12px] text-muted">取消</button>
            <button onClick={() => { setWorktree('enso/ui-rework'); setDirty(false); setOpen(false); }} className="rounded-control bg-surface-foreground px-3 py-1 text-[12px] text-surface">仍然切换</button>
          </div>
        </div>
      ) : (
        <>
          <MenuItem icon="icon-[lucide--laptop]" label="本地工作区" hint="直接在主工作树里工作" checked={!worktree} onClick={() => { setWorktree(''); setOpen(false); }} />
          <MenuItem icon="icon-[lucide--git-fork]" label="新建隔离 worktree" hint="让这个会话在独立的 git worktree 里运行" onClick={() => setDirty(true)} />
          <MenuSeparator />
          <MenuLabel>已有 worktree</MenuLabel>
          <MenuItem icon="icon-[lucide--git-fork]" label="enso/file-search" hint="有未提交改动 · 1 个会话" checked={worktree === 'enso/file-search'} onClick={() => { setWorktree('enso/file-search'); setOpen(false); }} />
          <MenuSeparator />
          <MenuLabel>本地分支</MenuLabel>
          <MenuItem icon="icon-[lucide--git-branch]" label="main" checked={!worktree} onClick={() => setOpen(false)} />
          <MenuItem icon="icon-[lucide--git-branch]" label="feat/status-line" onClick={() => setOpen(false)} />
          <MenuItem icon="icon-[lucide--plus]" label="新建分支" hint="从当前 HEAD 新建，并切换此工作区的所有会话" onClick={() => { setOpen(false); setNotice('新建分支：输入分支名称后「新建并切换」。同名分支已存在时给出错误（设计预览）。'); }} />
        </>
      )}
    </Popover>
  );
}

export function ApprovalModePicker() {
  const { approval, setApproval } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [reviewerReady] = useState(false);
  const current = approvalModes.find((mode) => mode.id === approval) ?? approvalModes[1];
  return (
    <Popover open={open} setOpen={setOpen} width="w-80" trigger={
      <button className={pill} title={current.desc} onClick={() => setOpen(!open)}>
        <span className={`${current.icon} size-3 shrink-0`} />
        <span className="truncate">{current.label}</span>
        <span className="icon-[lucide--chevron-down] size-3 shrink-0" />
      </button>
    }>
      {approvalModes.map((mode) => {
        const disabled = mode.id === 'assistant' && !reviewerReady;
        return <MenuItem key={mode.id} icon={mode.icon} label={mode.label} hint={disabled ? '请先在设置里选择助手代审模型' : mode.desc} checked={mode.id === approval} disabled={disabled} onClick={() => { if (!disabled) { setApproval(mode.id); setOpen(false); } }} />;
      })}
    </Popover>
  );
}

/** 模型选择：厂商 → 服务商条目（账号、套餐、额度）→ 模型；搜索；虚拟模型；推理开关与思考档位 */
export function ModelPicker() {
  const { modelChoice, setModelChoice, reasoning, setReasoning, thinking, setThinking } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(modelChoice.vendor);
  const [entry, setEntry] = useState(modelChoice.entry);
  const [query, setQuery] = useState('');
  const vendorEntry = vendors.find((item) => item.id === vendor) ?? vendors[0];
  const current = vendorEntry.entries.find((item) => item.id === entry) ?? vendorEntry.entries[0];
  const hits = query.trim() ? vendors.flatMap((v) => v.entries.flatMap((e) => e.models.filter((m) => m.toLowerCase().includes(query.toLowerCase())).map((m) => ({ v, e, m })))) : [];
  const pick = (v: string, e: string, m: string, virtual = false) => { setModelChoice({ vendor: v, entry: e, model: m, virtual }); setOpen(false); };
  return (
    <Popover open={open} setOpen={setOpen} align="right" width="w-[560px]" trigger={
      <button className={pill} title="选择模型 (⌘.)" onClick={() => setOpen(!open)}>
        <span className={`${modelChoice.virtual ? 'icon-[lucide--shuffle]' : 'icon-[lucide--sparkle]'} size-3.5 shrink-0 text-primary`} />
        <span className="truncate">{modelChoice.model}</span>
        {reasoning && <span className="shrink-0 text-[11px] text-faint">· {thinking}</span>}
        <span className="icon-[lucide--chevron-down] size-3 shrink-0" />
      </button>
    }>
      <label className="mb-1 flex h-8 items-center gap-2 rounded-[4px] bg-panel px-2 text-muted">
        <span className="icon-[lucide--search] size-3.5" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" aria-label="搜索模型" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
      </label>
      {query.trim() ? (
        <div className="max-h-[260px] overflow-y-auto">
          {hits.length ? hits.map(({ v, e, m }) => <MenuItem key={`${e.id}/${m}`} label={m} hint={`${v.label} · ${e.primary}`} checked={modelChoice.model === m && modelChoice.entry === e.id} onClick={() => pick(v.id, e.id, m)} />) : <p className="px-2 py-6 text-center text-[12px] text-muted">没有匹配的模型</p>}
        </div>
      ) : (
        <div className="grid h-[248px] grid-cols-[132px_170px_1fr] gap-1">
          <div className="overflow-y-auto border-r border-line pr-1">
            <MenuLabel>虚拟模型</MenuLabel>
            {virtualModels.map((name) => <MenuItem key={name} icon="icon-[lucide--shuffle]" label={name} checked={modelChoice.model === name} onClick={() => pick('virtual', 'virtual', name, true)} />)}
            <MenuSeparator />
            {vendors.map((item) => (
              <button key={item.id} onMouseEnter={() => { setVendor(item.id); setEntry(item.entries[0].id); }} onClick={() => { setVendor(item.id); setEntry(item.entries[0].id); }} className={`flex w-full items-center justify-between rounded-[4px] px-2 py-1.5 text-left text-[13px] ${vendor === item.id ? 'bg-hover' : 'hover:bg-hover'}`}>
                {item.label}
                <span className="icon-[lucide--chevron-right] size-3 text-faint" />
              </button>
            ))}
          </div>
          <div className="overflow-y-auto border-r border-line pr-1">
            <MenuLabel>{vendorEntry.label}</MenuLabel>
            {vendorEntry.entries.map((item) => (
              <button key={item.id} onMouseEnter={() => setEntry(item.id)} onClick={() => setEntry(item.id)} className={`flex w-full items-start gap-1 rounded-[4px] px-2 py-1.5 text-left ${entry === item.id ? 'bg-hover' : 'hover:bg-hover'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{item.primary}{item.plan && <span className="ml-1 rounded-[3px] bg-primary-soft px-1 text-[11px] text-primary">{item.plan}</span>}</span>
                  <span className="block truncate text-[11px] text-muted">{item.secondary}</span>
                  {item.usage && <span className="block text-[11px] text-faint">{item.usage} · 3 小时后重置</span>}
                </span>
                <span className="icon-[lucide--chevron-right] mt-1 size-3 text-faint" />
              </button>
            ))}
          </div>
          <div className="overflow-y-auto">
            <MenuLabel>显示 {current.models.length} / 共 {current.models.length} 个模型</MenuLabel>
            {current.models.map((name) => <MenuItem key={name} label={name} hint="上下文窗口 200K" checked={modelChoice.model === name && modelChoice.entry === current.id} onClick={() => pick(vendorEntry.id, current.id, name)} />)}
          </div>
        </div>
      )}
      <MenuSeparator />
      <div className="flex items-center gap-3 px-2 py-1.5">
        <span className="flex items-center gap-2 text-[12px]">
          <Switch label="推理" checked={reasoning} onChange={setReasoning} />
          推理
        </span>
        <span className="ml-auto text-[11px] text-muted">思考档位</span>
        <div className={`flex h-7 items-center rounded-control bg-control/55 p-[2px] ${reasoning ? '' : 'pointer-events-none opacity-45'}`}>
          {thinkingLevels.slice(1).map((level) => (
            <button key={level} onClick={() => setThinking(level)} className={`h-full rounded-[4px] px-2.5 text-[12px] ${thinking === level ? 'bg-surface font-medium' : 'text-muted'}`}>{level}</button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

export function PlanModeToggle() {
  const { planMode, setPlanMode } = useWorkbench();
  return (
    <button aria-pressed={planMode} onClick={() => setPlanMode(!planMode)} title={planMode ? 'Plan 模式已开启：只读调研，再提交计划给你审批' : '先计划：只读调研，提交计划后再执行'} className={`${pill} ${planMode ? 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary' : ''}`}>
      <span className="icon-[lucide--clipboard-list] size-3.5 shrink-0" />
      计划
    </button>
  );
}

const statusSegments = [
  { id: 'tokens', label: 'Token', value: '↑ 48.2K ↓ 6.1K' },
  { id: 'cache', label: '缓存', value: '缓存 82%' },
  { id: 'turns', label: '轮次', value: '4 轮 · 37 步' },
  { id: 'speed', label: '速度', value: '68 tok/s' },
  { id: 'duration', label: 'LLM', value: 'LLM 3m12s' },
  { id: 'sessionTime', label: '会话时长', value: '会话 24m' },
  { id: 'coworkers', label: '队员', value: '2 名队员' },
  { id: 'usage', label: '额度', value: '5h 42% · 3 小时后重置' },
];

/** 输入框下方状态栏（StatsLine）：模型 / 上下文 + 可选字段；右侧齿轮自定义字段与排序 */
export function StatsLine() {
  const { setNotice } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<'minimal' | 'default' | 'full'>('default');
  const [context, setContext] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open || context, () => { setOpen(false); setContext(false); });
  const visible = preset === 'minimal' ? [] : preset === 'default' ? statusSegments.slice(0, 6) : statusSegments;
  return (
    <div ref={ref} className="relative mt-1.5 flex h-5 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] text-faint">
      <button onClick={() => setContext(!context)} title="上下文窗口" className="flex shrink-0 items-center gap-1.5 hover:text-surface-foreground">
        <span className="inline-block h-[3px] w-10 rounded-full bg-control"><span className="block h-full w-[24%] rounded-full bg-primary/70" /></span>
        上下文 24%
      </button>
      {visible.map((segment) => <span key={segment.id} className="shrink-0 tabular-nums">{segment.value}</span>)}
      <button onClick={() => setOpen(!open)} title="状态栏设置" aria-label="状态栏设置" className="ml-auto flex size-5 shrink-0 items-center justify-center rounded hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--settings-2] size-3" /></button>
      {open && (
        <MenuPanel label="状态栏设置" className="bottom-6 right-0 w-64">
          <div className="flex gap-1 p-1">
            {(['minimal', 'default', 'full'] as const).map((id) => <button key={id} onClick={() => setPreset(id)} className={`flex-1 rounded-[4px] py-1 text-[12px] ${preset === id ? 'bg-selected font-medium' : 'text-muted hover:bg-hover'}`}>{id === 'minimal' ? '简洁' : id === 'default' ? '默认' : '完整'}</button>)}
          </div>
          <MenuSeparator />
          <MenuLabel>拖动排序 · 模型与上下文固定在前</MenuLabel>
          {statusSegments.map((segment, index) => (
            <label key={segment.id} className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-[12px] hover:bg-hover">
              <span className="icon-[lucide--grip-vertical] size-3 text-faint" />
              <input type="checkbox" checked={visible.includes(segment)} onChange={() => setPreset('full')} />
              {segment.label}
              {index === 7 && <span className="ml-auto text-[11px] text-faint">会轮询额度</span>}
            </label>
          ))}
        </MenuPanel>
      )}
      {context && (
        <MenuPanel label="上下文检查" className="bottom-6 left-0 w-80">
          <div className="p-2">
            <div className="flex items-baseline justify-between"><span className="text-[13px] font-medium">上下文窗口</span><span className="text-[12px] tabular-nums text-muted">48.2K / 200K · 估算</span></div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-control">
              <span className="w-[6%] bg-surface-foreground/70" /><span className="w-[4%] bg-warning" /><span className="w-[9%] bg-primary" /><span className="w-[5%] bg-success" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted">
              <span>■ 系统提示 12.1K</span><span className="text-warning">■ 工具说明 8.0K</span><span className="text-primary">■ 对话 18.4K</span><span className="text-success">■ 工具结果 9.7K</span>
            </div>
            <p className="mt-3 border-t border-line pt-2 text-[11px] leading-5 text-muted">3 条旧消息已不在窗口，只留摘要 · 当前摘要由另一模型生成</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { setContext(false); setNotice('已排队：本轮结束后压缩（设计预览）。'); }} className="flex-1 rounded-control border border-border py-1.5 text-[12px] hover:bg-hover">本轮结束后压缩</button>
              <button onClick={() => { setContext(false); setNotice('对话分支：保留源线，从当前位置开一个新会话（设计预览）。'); }} className="rounded-control border border-border px-3 py-1.5 text-[12px] hover:bg-hover">对话分支</button>
            </div>
          </div>
        </MenuPanel>
      )}
    </div>
  );
}

type Mention = { kind: 'file' | 'agent' | 'skill'; label: string };
const mentionOptions: (Mention & { hint: string; icon: string })[] = [
  { kind: 'file', label: 'Sidebar.tsx', hint: 'src/renderer/components/chat', icon: 'icon-[lucide--file-code-2]' },
  { kind: 'file', label: 'globals.css', hint: 'src/renderer/styles', icon: 'icon-[lucide--file-text]' },
  { kind: 'agent', label: 'reviewer', hint: '子代理类型 · 只读审查', icon: 'icon-[lucide--bot]' },
  { kind: 'agent', label: '回归检查', hint: '持久协作者', icon: 'icon-[lucide--bot]' },
];
const slashOptions = [
  { name: '/goal', hint: '设置会话目标（/goal <目标> · pause · resume · clear）' },
  { name: '/compact', hint: '立即压缩上下文（/compact [摘要侧重]）' },
  { name: '/plan', hint: 'Plan 模式：只读调研，再审批计划（/plan [任务] · off）' },
  { name: '/skill:frontend-design', hint: '按设计规范实现前端界面' },
  { name: '/skill:project-knowledge', hint: '检索项目约定与踩坑记录' },
];

/**
 * 输入框（chat/Composer.tsx）：@ 引用文件/会话/Agent，/ 命令与技能，图片附件，语音，
 * 运行中「排队 / 插入本轮」，审批挂起时锁定。
 */
export function Composer({ onSend, initial = '', running = false, locked = false, queuedCount = 0, started = true, onStop }: { onSend: (text: string) => void; initial?: string; running?: boolean; locked?: boolean; queuedCount?: number; started?: boolean; onStop?: () => void }) {
  const { planMode, setNotice } = useWorkbench();
  const [draft, setDraft] = useState(initial);
  const [images, setImages] = useState(0);
  const [chips, setChips] = useState<Mention[]>([]);
  const [recording, setRecording] = useState(false);
  const popup = draft.endsWith('@') ? 'mention' : /(^|\s)\/[\w:-]*$/.test(draft) ? 'slash' : '';
  const ref = useDismiss<HTMLDivElement>(Boolean(popup), () => setDraft(draft.replace(/[@/][\w:-]*$/, '')));
  const agentRecipient = chips.find((chip) => chip.kind === 'agent');
  const hasContent = draft.trim().length > 0 || images > 0;
  const send = () => {
    if (!hasContent || locked) return;
    onSend(draft.trim() || `[${images} 张图片]`);
    setDraft(''); setImages(0); setChips([]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !popup) { event.preventDefault(); send(); }
  };
  const placeholder = locked ? '请先处理待审批的操作' : agentRecipient ? '向所选 Agent 发送消息…' : running ? (queuedCount ? '按 Enter 将下一条排队消息插入本轮…' : '消息将排队,本轮结束后发送…') : planMode ? '描述任务——先出计划' : '输入 @ 选择文件或 Agent';
  return (
    <section aria-label="消息输入" className="shrink-0">
      <div ref={ref} className={`relative rounded-control border bg-input ${locked ? 'border-line opacity-80' : 'border-border focus-within:border-primary/60'}`}>
        {popup && (
          <MenuPanel label={popup === 'mention' ? '输入 @ 选择文件或 Agent' : '命令建议'} className="bottom-full left-0 mb-1 w-[420px]">
            <MenuLabel>{popup === 'mention' ? '输入 @ 选择文件或 Agent' : '命令建议'}</MenuLabel>
            {popup === 'mention'
              ? mentionOptions.map((option) => <MenuItem key={option.label} icon={option.icon} label={option.label} hint={option.hint} onClick={() => { setChips([...chips, option]); setDraft(draft.slice(0, -1)); }} />)
              : slashOptions.map((option) => <MenuItem key={option.name} icon="icon-[lucide--square-slash]" label={option.name} hint={option.hint} onClick={() => { if (option.name.startsWith('/skill')) setChips([...chips, { kind: 'skill', label: option.name.slice(7) }]); setDraft(draft.replace(/\/[\w:-]*$/, option.name.startsWith('/skill') ? '' : `${option.name} `)); }} />)}
          </MenuPanel>
        )}
        {(chips.length > 0 || images > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {Array.from({ length: images }).map((_, index) => (
              <span key={index} className="relative flex size-11 items-center justify-center rounded-[4px] border border-border bg-panel text-faint">
                <span className="icon-[lucide--image] size-4" />
                <button aria-label="移除" onClick={() => setImages(images - 1)} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-surface-foreground text-surface"><span className="icon-[lucide--x] size-2.5" /></button>
              </span>
            ))}
            {chips.map((chip, index) => (
              <span key={`${chip.label}-${index}`} className={`flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[12px] ${chip.kind === 'agent' ? 'bg-primary-soft text-primary' : chip.kind === 'skill' ? 'bg-success-soft text-success' : 'bg-control text-surface-foreground'}`}>
                <span className={`${chip.kind === 'file' ? 'icon-[lucide--file-code-2]' : chip.kind === 'agent' ? 'icon-[lucide--bot]' : 'icon-[lucide--sparkles]'} size-3`} />
                {chip.kind === 'agent' ? '@' : chip.kind === 'skill' ? '/' : ''}{chip.label}
                <button aria-label="移除" onClick={() => setChips(chips.filter((_, i) => i !== index))}><span className="icon-[lucide--x] size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <textarea aria-label="输入消息" disabled={locked} placeholder={placeholder} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} className="block h-[64px] w-full bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-6 outline-none placeholder:text-faint" />
        {draft.length > 2000 && <p className="px-3.5 text-[11px] text-faint">{draft.length} 字符</p>}
        <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
          <button aria-label="添加图片" title="添加图片" onClick={() => setImages(Math.min(images + 1, 4))} className="flex size-7 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--image-plus] size-3.5" /></button>
          <button aria-label="语音输入" title={recording ? '停止录音' : '按住 Space 说话'} onClick={() => { setRecording(!recording); if (recording) setDraft(`${draft}把审批按钮放到右侧`); }} className={`flex size-7 shrink-0 items-center justify-center rounded-control hover:bg-hover ${recording ? 'bg-danger-soft text-danger' : 'text-muted'}`}><span className={`${recording ? 'icon-[lucide--square]' : 'icon-[lucide--mic]'} size-3.5`} /></button>
          {recording && <span className="shrink-0 text-[11px] text-danger">请说话 · 再次点击结束</span>}
          {!recording && (
            <>
              <PresetPicker started={started} />
              <WorktreePicker />
              <PlanModeToggle />
              <ApprovalModePicker />
            </>
          )}
          <div className="min-w-2 flex-1" />
          <ModelPicker />
          {running && !hasContent ? (
            <button aria-label="停止" title="停止 (Esc)" onClick={() => { onStop?.(); setNotice('已停止本轮（设计预览）。'); }} className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-foreground text-surface hover:opacity-85"><span className="icon-[lucide--circle-stop] size-4" /></button>
          ) : (
            <button aria-label={agentRecipient ? '仅发送给所选 Agent' : '发送'} title={agentRecipient ? '仅发送给所选 Agent' : '发送 Enter'} disabled={!hasContent || locked} onClick={send} className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35"><span className="icon-[lucide--arrow-up] size-4" /></button>
          )}
        </div>
      </div>
      <StatsLine />
    </section>
  );
}
