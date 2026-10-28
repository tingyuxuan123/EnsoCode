import { useState } from 'react';
import { DangerConfirm, Dialog, Empty, Segmented, Switch, inputClass } from '../../Controls';
import { Overlay } from '../../Workbench';
import { Badge, SettingsHeader, SettingsSection, outlineButton, primaryButton } from '../SettingsUI';
import { ToolGate } from './common';

type Step = { id: string; label: string; agent: string; prompt: string };
type Stage = { id: string; name: string; steps: Step[] };
type Arg = { key: string; label: string; def: string; required: boolean };

const seedStages: Stage[] = [
  { id: 'st1', name: '调研', steps: [{ id: 'p1', label: '实现', agent: 'scout', prompt: '调研 {{args.question}} 在实现中的位置，引用文件与行号。' }, { id: 'p2', label: '测试', agent: 'scout', prompt: '找出覆盖 {{args.question}} 的测试与缺口。' }] },
  { id: 'st2', name: '汇总', steps: [{ id: 'p3', label: '结论', agent: 'worker', prompt: '基于 {{上一阶段输出}} 给出 300 字以内的结论。' }] },
];
const seedArgs: Arg[] = [{ key: 'question', label: '问题', def: '', required: true }];
const custom = [
  { id: 'release-check', name: '发版前检查', description: '并行跑类型、Lint、测试，再由 reviewer 汇总风险。', source: '~/.agents/workflows' },
  { id: 'ui-audit', name: '界面巡检', description: '截图各页面并找出裁切、错位和空图标。', source: '项目 .agents/workflows' },
];
const builtins = [
  { id: 'parallel-review', name: '并行审查', description: '用只读审查代理按多个维度并行审查一组改动。', args: '审查范围 · 审查维度（逗号分隔）' },
  { id: 'multi-angle-investigation', name: '多角度调研', description: '用只读侦察代理从实现、测试、文档三个角度并行调研同一个问题。', args: '问题 *' },
];

const script = (stages: Stage[]) => `const r1 = await phase('${stages[0]?.name ?? ''}', () => parallel([\n${(stages[0]?.steps ?? []).map((s) => `  () => agent(\`${s.prompt}\`, { label: '${s.label}', agentType: '${s.agent}' }),`).join('\n')}\n]));\n${stages.slice(1).map((st, i) => `const r${i + 2} = await phase('${st.name}', () => parallel([\n${st.steps.map((s) => `  () => agent(\`${s.prompt}\`, { label: '${s.label}', agentType: '${s.agent}' }),`).join('\n')}\n]));`).join('\n')}\nreturn r${stages.length};`;

/** WorkflowDesigner：阶段列从左到右依次执行，同列步骤并行；点节点在右侧编辑属性 */
function Designer({ stages, setStages, args }: { stages: Stage[]; setStages: (value: Stage[]) => void; args: Arg[] }) {
  const [selected, setSelected] = useState<{ stage: string; step?: string }>({ stage: 'st1', step: 'p1' });
  const stage = stages.find((item) => item.id === selected.stage);
  const step = stage?.steps.find((item) => item.id === selected.step);
  const patchStep = (patch: Partial<Step>) => setStages(stages.map((st) => st.id === selected.stage ? { ...st, steps: st.steps.map((s) => s.id === selected.step ? { ...s, ...patch } : s) } : st));
  return (
    <div className="flex min-h-[300px] gap-3">
      <div className="min-w-0 flex-1 overflow-x-auto rounded-control border border-line bg-panel/50 p-3">
        <div className="flex items-stretch gap-2">
          <div className="flex w-[92px] shrink-0 flex-col items-center justify-center rounded-control border border-dashed border-border bg-surface px-2 py-3 text-center text-[11px] text-muted">
            <span className="icon-[lucide--play] size-3.5 text-success" />
            <span className="mt-1 font-medium text-surface-foreground">开始</span>
            <span className="mt-1">{args.length ? args.map((a) => a.label).join(' · ') : '无参数'}</span>
          </div>
          {stages.map((st, index) => (
            <div key={st.id} className="flex shrink-0 items-stretch gap-2">
              <button title="在此插入阶段" onClick={() => setStages([...stages.slice(0, index), { id: `st${Date.now()}`, name: '', steps: [{ id: `p${Date.now()}`, label: '', agent: 'worker', prompt: '' }] }, ...stages.slice(index)])} className="flex w-4 items-center justify-center text-faint hover:text-primary"><span className="icon-[lucide--plus] size-3" /></button>
              <div className={`flex w-[168px] flex-col rounded-control border bg-surface ${selected.stage === st.id && !selected.step ? 'border-primary' : 'border-line'}`}>
                <button onClick={() => setSelected({ stage: st.id })} className="flex h-8 items-center gap-1.5 border-b border-line px-2 text-left text-[12px]">
                  <span className="text-faint">阶段 {index + 1}</span>
                  <span className={`truncate font-medium ${st.name ? '' : 'text-danger'}`}>{st.name || '未命名阶段'}</span>
                </button>
                <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                  {st.steps.map((s) => (
                    <button key={s.id} onClick={() => setSelected({ stage: st.id, step: s.id })} className={`rounded-[4px] border px-2 py-1.5 text-left ${selected.step === s.id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover'}`}>
                      <span className={`block truncate text-[12px] font-medium ${s.label ? '' : 'text-danger'}`}>{s.label || '未命名步骤'}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{s.agent}</span>
                      <span className={`block truncate text-[11px] ${s.prompt ? 'text-muted' : 'text-danger'}`}>{s.prompt || '尚未填写提示词'}</span>
                    </button>
                  ))}
                  <button onClick={() => setStages(stages.map((x) => x.id === st.id ? { ...x, steps: [...x.steps, { id: `p${Date.now()}`, label: '', agent: 'worker', prompt: '' }] } : x))} className="flex h-7 items-center justify-center gap-1 rounded-[4px] border border-dashed border-border text-[11px] text-muted hover:text-primary"><span className="icon-[lucide--plus] size-3" />并行步骤</button>
                </div>
              </div>
            </div>
          ))}
          <button title="在此插入阶段" onClick={() => setStages([...stages, { id: `st${Date.now()}`, name: '', steps: [{ id: `p${Date.now()}`, label: '', agent: 'worker', prompt: '' }] }])} className="flex w-4 items-center justify-center text-faint hover:text-primary"><span className="icon-[lucide--plus] size-3" /></button>
          <div className="flex w-[80px] shrink-0 flex-col items-center justify-center rounded-control border border-dashed border-border bg-surface text-[11px] text-muted">
            <span className="icon-[lucide--flag] size-3.5" />
            <span className="mt-1 font-medium text-surface-foreground">结果</span>
            <span>末阶段输出</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted">点击节点即可编辑。同一列的步骤并行执行，各列从左到右依次执行。</p>
      </div>
      <aside className="w-[220px] shrink-0 rounded-control border border-line p-3 text-[12px]">
        {step ? (
          <>
            <p className="mb-2 text-[11px] text-faint">阶段 {stages.findIndex((x) => x.id === selected.stage) + 1} · 步骤 {(stage?.steps.findIndex((x) => x.id === step.id) ?? 0) + 1}</p>
            <label className="mb-2 block text-muted">显示名<input value={step.label} onChange={(e) => patchStep({ label: e.target.value })} className={`${inputClass} mt-1 h-8`} /></label>
            <label className="mb-2 block text-muted">子代理类型
              <select value={step.agent} onChange={(e) => patchStep({ agent: e.target.value })} className={`${inputClass} mt-1 h-8`}><option value="worker">默认（worker）</option><option>scout</option><option>reviewer</option><option>tester</option></select>
            </label>
            <label className="block text-muted">提示词<textarea value={step.prompt} onChange={(e) => patchStep({ prompt: e.target.value })} className="mt-1 h-24 w-full rounded-control border border-border bg-input p-2 text-[12px] text-surface-foreground outline-none" /></label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-[11px] text-faint">插入参数</span>
              {args.map((a) => <button key={a.key} onClick={() => patchStep({ prompt: `${step.prompt}{{args.${a.key}}}` })} className="rounded-[4px] bg-control px-1 font-mono text-[11px]">{a.key}</button>)}
              <button onClick={() => patchStep({ prompt: `${step.prompt}{{上一阶段输出}}` })} className="rounded-[4px] bg-control px-1 text-[11px]">上一阶段输出</button>
            </div>
            <button onClick={() => { setStages(stages.map((x) => x.id === selected.stage ? { ...x, steps: x.steps.filter((s) => s.id !== step.id) } : x)); setSelected({ stage: selected.stage }); }} className="mt-3 text-[12px] text-danger">删除</button>
          </>
        ) : stage ? (
          <>
            <p className="mb-2 text-[11px] text-faint">阶段 {stages.findIndex((x) => x.id === stage.id) + 1}</p>
            <label className="block text-muted">阶段名称<input value={stage.name} onChange={(e) => setStages(stages.map((x) => x.id === stage.id ? { ...x, name: e.target.value } : x))} className={`${inputClass} mt-1 h-8`} /></label>
            <div className="mt-3 flex gap-2">
              <button className={outlineButton}>左移</button>
              <button className={outlineButton}>右移</button>
            </div>
            <button onClick={() => { setStages(stages.filter((x) => x.id !== stage.id)); setSelected({ stage: stages[0].id }); }} className="mt-3 text-[12px] text-danger">删除</button>
          </>
        ) : null}
      </aside>
    </div>
  );
}

export function WorkflowDialog({ onClose, initialView = 'design', initialName = '' }: { onClose: () => void; initialView?: 'design' | 'code'; initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialName ? '从实现、测试两个角度调研一个问题，再汇总结论。' : '');
  const [args, setArgs] = useState<Arg[]>(seedArgs);
  const [stages, setStages] = useState<Stage[]>(seedStages);
  const [view, setView] = useState<'design' | 'code'>(initialView);
  const [code, setCode] = useState(script(seedStages));
  const [detached, setDetached] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const save = () => {
    if (!name.trim()) return setError('请填写名称。');
    if (!detached && stages.some((st) => !st.name.trim() || st.steps.some((s) => !s.label.trim() || !s.prompt.trim()))) return setError('每个阶段需要名称，每个步骤需要显示名和提示词。');
    onClose();
  };
  return (
    <Overlay>
      <Dialog title={initialName ? '编辑工作流预设' : '新增工作流预设'} width={880} onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={save} className={primaryButton}>保存</button></>}>
        {error && <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium">名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：发版前检查" className={`${inputClass} mt-1.5 font-normal`} /></label>
          <label className="text-[12px] font-medium">描述<input value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} mt-1.5 font-normal`} /></label>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center text-[12px] font-medium">参数<span className="ml-2 font-normal text-faint">{args.length}/8</span><button disabled={args.length >= 8} onClick={() => setArgs([...args, { key: `arg${args.length + 1}`, label: '', def: '', required: false }])} className="ml-auto text-[12px] font-normal text-primary disabled:text-faint">添加参数</button></div>
          {args.map((arg, index) => (
            <div key={index} className="mb-1.5 grid grid-cols-[110px_1fr_1fr_auto_auto] items-center gap-2">
              <input value={arg.key} onChange={(e) => setArgs(args.map((a, i) => i === index ? { ...a, key: e.target.value } : a))} aria-label="参数 key" className={`${inputClass} h-8 font-mono text-[12px]`} />
              <input value={arg.label} placeholder="显示名" onChange={(e) => setArgs(args.map((a, i) => i === index ? { ...a, label: e.target.value } : a))} className={`${inputClass} h-8`} />
              <input value={arg.def} placeholder="默认值" onChange={(e) => setArgs(args.map((a, i) => i === index ? { ...a, def: e.target.value } : a))} className={`${inputClass} h-8`} />
              <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={arg.required} onChange={(e) => setArgs(args.map((a, i) => i === index ? { ...a, required: e.target.checked } : a))} />必填</label>
              <button onClick={() => setArgs(args.filter((_, i) => i !== index))} className="text-[12px] text-muted hover:text-danger">移除</button>
            </div>
          ))}
        </div>
        <div className="mb-2 mt-4 flex items-center gap-2">
          <span className="text-[12px] font-medium">步骤</span>
          <Segmented label="编辑方式" size="sm" value={view} onChange={(next) => { if (next === 'design' && detached) { setHint('该预设是纯代码，无法在设计器中显示。改用设计器会替换当前脚本。'); return; } setView(next); setCode(script(stages)); }} options={[{ value: 'design', label: '设计', icon: 'icon-[lucide--workflow]' }, { value: 'code', label: '代码', icon: 'icon-[lucide--code-xml]' }]} />
          {view === 'code' && <button onClick={() => setHint('设计器生成的代码已是规范格式')} className="ml-auto text-[12px] text-primary">格式化</button>}
        </div>
        {hint && (
          <div className="mb-2 flex items-center gap-2 rounded-control bg-panel px-3 py-2 text-[12px] text-muted">
            <span className="icon-[lucide--info] size-3.5 text-primary" />
            <span className="flex-1">{hint}</span>
            {detached && hint.startsWith('该预设') && <button onClick={() => { setDetached(false); setView('design'); setHint(''); }} className="text-primary">改用设计器</button>}
            <button onClick={() => setHint('')} aria-label="关闭"><span className="icon-[lucide--x] size-3" /></button>
          </div>
        )}
        {view === 'design' ? (
          <Designer stages={stages} setStages={setStages} args={args} />
        ) : (
          <>
            <textarea value={code} onChange={(e) => { setCode(e.target.value); setDetached(true); }} spellCheck={false} aria-label="工作流脚本" className="h-[260px] w-full rounded-control border border-border bg-code p-3 font-mono text-[12px] leading-5 outline-none" />
            <p className="mt-1.5 text-[11px] leading-5 text-muted">{detached ? '纯 JavaScript，支持顶层 await，以 return 结束。可用：agent(prompt, opts)、parallel、pipeline、phase、log、args。' : '由设计生成。手动修改代码后将脱离设计器，变为纯代码预设。'}</p>
          </>
        )}
      </Dialog>
    </Overlay>
  );
}

export function WorkflowsPage({ openDialog = false, emptyCustom = false }: { openDialog?: boolean; emptyCustom?: boolean }) {
  const [editing, setEditing] = useState<string | null>(openDialog ? 'investigate' : null);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [list, setList] = useState(emptyCustom ? [] : custom);
  const [remove, setRemove] = useState('');
  return (
    <>
      <SettingsHeader title="工作流" description="可在侧边栏「工作流」面板中运行的预设" actions={<button onClick={() => setEditing('new')} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />新增工作流预设</button>} />
      <ToolGate tool="工作流" />
      <p className="-mt-3 mb-5 text-[12px] text-muted">同名时项目 .agents/workflows 下的文件优先于这里，其次是 ~/.agents/workflows 和内置预设。</p>
      <SettingsSection title="自定义预设">
        {list.length ? (
          <div className="divide-y divide-line rounded-control border border-line">
            {list.map((preset) => (
              <div key={preset.id} className="group flex items-center gap-3 px-3 py-2.5">
                <span className="icon-[lucide--workflow] size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">{preset.name}<Badge><span className="font-mono">{preset.id}</span></Badge><span className="text-[11px] font-normal text-faint">{preset.source}</span></div>
                  <p className="truncate text-[12px] text-muted">{preset.description}</p>
                </div>
                <button onClick={() => setEditing(preset.id)} aria-label="编辑" title="编辑" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover group-hover:opacity-100"><span className="icon-[lucide--pencil] size-3.5" /></button>
                <button onClick={() => setRemove(preset.id)} aria-label="删除" title="删除" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover hover:text-danger group-hover:opacity-100"><span className="icon-[lucide--trash-2] size-3.5" /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--workflow]" title="还没有自定义工作流预设" action={<button onClick={() => setEditing('new')} className={outlineButton}>新增工作流预设</button>} /></div>
        )}
      </SettingsSection>
      <SettingsSection title="内置预设">
        <div className="divide-y divide-line rounded-control border border-line">
          {builtins.map((preset) => (
            <div key={preset.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">{preset.name}<Badge><span className="font-mono">{preset.id}</span></Badge></div>
                <p className="text-[12px] text-muted">{preset.description}</p>
                <p className="mt-0.5 text-[12px] text-muted">参数：{preset.args}</p>
              </div>
              <Switch label={preset.name} checked={!disabled.includes(preset.id)} onChange={(on) => setDisabled(on ? disabled.filter((id) => id !== preset.id) : [...disabled, preset.id])} />
            </div>
          ))}
        </div>
      </SettingsSection>
      {editing && <WorkflowDialog onClose={() => setEditing(null)} initialName={editing === 'new' ? '' : '实现与测试双线调研'} />}
      {remove && <Overlay><DangerConfirm title="删除工作流预设？" description={`将删除「${list.find((p) => p.id === remove)?.name}」。侧边栏「工作流」面板不再列出它。`} confirmLabel="删除" requireCheck={false} onClose={() => setRemove('')} onConfirm={() => { setList(list.filter((p) => p.id !== remove)); setRemove(''); }} /></Overlay>}
    </>
  );
}
