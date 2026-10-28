import { useState } from 'react';
import { Spinner } from '../Controls';
import { useReadPanelPreset } from './preset';
import { DashedState, PreviewStates, Toolbar } from './PanelUI';

export type WorkflowPreset = { state: 'running' | 'done' | 'failed' | 'empty' | 'nomodel' };

const phases = [
  {
    phase: '调研',
    steps: [
      { id: 's1', label: '读取设置页结构', agent: 'scout', status: 'done', log: 'read settings/*.tsx (21 files) · 6.2K tokens' },
      { id: 's2', label: '核对 i18n 文案', agent: 'scout', status: 'done', log: 'grep 中文标签 · 214 命中' },
    ],
  },
  {
    phase: '实现',
    parallel: true,
    steps: [
      { id: 's3', label: '重构导航', agent: 'worker', status: 'running', log: 'edit SettingsWindow.tsx · +48 −12' },
      { id: 's4', label: '统一页内排版', agent: 'worker', status: 'running', log: 'edit core/GeneralPage.tsx · +36 −9' },
      { id: 's5', label: '补显隐测试', agent: 'tester', status: 'queued', log: '' },
    ],
  },
  {
    phase: '验收',
    steps: [{ id: 's6', label: '审查改动', agent: 'reviewer', status: 'failed', log: '未通过：GroupChips 横滑没有键盘入口' }],
  },
];

const params = [
  { name: '目标目录', value: 'src/renderer/components/settings', required: true },
  { name: '是否更新文案', value: '是', required: false },
];

const tone: Record<string, string> = { done: 'text-success', running: 'text-primary', queued: 'text-muted', failed: 'text-danger' };
const label: Record<string, string> = { done: '已完成', running: '运行中', queued: '排队', failed: '失败' };

/**
 * 工作流运行（sidepanel/WorkflowView.tsx）：选预设、填参数（至多 8 个）、运行 / 停止、
 * 阶段与并行步骤、每步子代理状态与日志、失败原因、清除已结束、还没有工作流、没有可用模型。
 */
export function WorkflowView() {
  const preset = useReadPanelPreset<WorkflowPreset>('workflow');
  const [state, setState] = useState<WorkflowPreset['state']>(preset.state ?? 'running');
  const [presetName, setPresetName] = useState('设置页重构');
  const [openStep, setOpenStep] = useState('s3');
  if (state === 'empty') {
    return (
      <div className="flex h-full flex-col bg-surface">
        <Toolbar><span className="text-[12px] font-medium">工作流</span></Toolbar>
        <DashedState icon="icon-[lucide--workflow]">还没有工作流<p className="text-faint">在「设置 → 工作流」里新增预设，或把项目 .agents/workflows 下的文件放进来。</p></DashedState>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Toolbar>
        <span className="text-[12px] font-medium">工作流</span>
        <select value={presetName} onChange={(event) => setPresetName(event.target.value)} aria-label="预设" className="ml-1 h-6.5 max-w-[168px] rounded-control border border-border bg-input px-1.5 text-[12px] outline-none">
          <option>设置页重构</option>
          <option>回归检查</option>
          <option>发布前自检</option>
        </select>
        <button className="ml-auto rounded-control border border-border px-2 py-0.5 text-[11px] hover:bg-hover">管理工作流预设</button>
      </Toolbar>
      {state === 'nomodel' ? (
        <div className="m-3 flex items-start gap-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] leading-5">
          <span className="icon-[lucide--triangle-alert] mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>没有可用模型。请先配置提供商凭证并启用模型。<a className="ml-1 text-primary" href="#/settings-providers">前往模型中心</a></span>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-medium">{presetName}</span>
              {state === 'running' ? <><Spinner className="size-3.5" /><span className="text-muted">运行中 · 3 个子代理</span></> : state === 'done' ? <span className="text-success">已完成</span> : <span className="text-danger">失败</span>}
              <span className="ml-auto" />
              {state === 'running' ? (
                <button onClick={() => setState('failed')} className="rounded-control border border-border px-2 py-0.5 text-[11px] text-danger hover:bg-danger-soft">停止</button>
              ) : (
                <>
                  <button onClick={() => setState('running')} className="rounded-control border border-border px-2 py-0.5 text-[11px] hover:bg-hover">重新运行</button>
                  <button className="text-[11px] text-muted hover:text-surface-foreground">清除已结束</button>
                </>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {params.map((param) => (
                <label key={param.name} className="text-[11px] text-muted">
                  {param.name}{param.required && <span className="text-danger"> *</span>}
                  <input defaultValue={param.value} className="mt-1 h-7 w-full rounded-control border border-border bg-input px-2 font-mono text-[11.5px] text-surface-foreground outline-none" />
                </label>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
            {phases.map((group) => (
              <section key={group.phase} className="mb-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                  <span className="font-medium text-surface-foreground">{group.phase}</span>
                  {group.parallel && <span className="rounded-[4px] bg-control px-1 text-muted">并行</span>}
                </div>
                <div className="space-y-1">
                  {group.steps.map((step) => {
                    const shown = state === 'failed' && step.status === 'failed' ? 'failed' : state === 'done' ? 'done' : step.status;
                    return (
                      <div key={step.id} className="rounded-control border border-line">
                        <button onClick={() => setOpenStep(openStep === step.id ? '' : step.id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]">
                          {shown === 'running' ? <Spinner className="size-3.5" /> : <span className={`${shown === 'failed' ? 'icon-[lucide--circle-x] text-danger' : shown === 'done' ? 'icon-[lucide--circle-check] text-success' : 'icon-[lucide--clock] text-muted'} size-3.5 shrink-0`} />}
                          <span className="min-w-0 flex-1 truncate">{step.label}</span>
                          <span className="shrink-0 font-mono text-[11px] text-faint">{step.agent}</span>
                          <span className={`shrink-0 text-[11px] ${tone[shown]}`}>{label[shown]}</span>
                        </button>
                        {(openStep === step.id || shown === 'failed') && step.log && (
                          <pre className="mx-2 mb-1.5 rounded-[4px] bg-code px-2 py-1 font-mono text-[11px] leading-5 text-muted">{step.log}</pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {state === 'failed' && (
              <div className="rounded-control border border-danger/30 bg-danger-soft px-2.5 py-2 text-[11.5px] leading-5 text-danger">
                审查未通过：GroupChips 的横滑在纯键盘下不可达。已保留前两阶段产物，可在失败步骤上重试，或修改后重新运行。
                <button className="ml-2 underline underline-offset-2">重试该步骤</button>
              </div>
            )}
          </div>
        </>
      )}
      <PreviewStates value={state} onChange={setState} options={[{ value: 'running', label: '运行中' }, { value: 'done', label: '已完成' }, { value: 'failed', label: '失败' }, { value: 'empty', label: '空态' }, { value: 'nomodel', label: '无模型' }]} />
    </div>
  );
}
