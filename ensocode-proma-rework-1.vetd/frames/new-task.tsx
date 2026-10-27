export const frame = { width: 1440, height: 900, title: "新建任务" };

import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { models, projects } from '../components/data';
import { useWorkbench } from '../components/Workbench';

const starters = [
  { icon: 'icon-[lucide--panels-top-left]', title: '调整界面', prompt: '请整理工作台的布局和组件样式，保留现有功能，并提供改动说明。' },
  { icon: 'icon-[lucide--bug]', title: '排查问题', prompt: '请先复现问题，沿完整链路定位根因，再给出最小修复和验证结果。' },
  { icon: 'icon-[lucide--scan-line]', title: '审查代码', prompt: '请审查当前改动，重点检查行为回归、安全边界和缺失的测试。' },
];
export default function NewTaskScreen() {
  const { model, setModel, approval, setApproval, setTask, setNotice } = useWorkbench();
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState(projects[0].name);
  const [worktree, setWorktree] = useState(false);
  const [reference, setReference] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-y-auto px-12 py-9">
      <div className="mx-auto max-w-[860px]">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-muted"><span className="icon-[lucide--folder-open] size-3.5" />{project}<span className="icon-[lucide--chevron-right] size-3" />新会话</div>
        <h1 className="text-[24px] font-semibold">开始一项新任务</h1>
        <p className="mt-2 text-[14px] text-muted">描述你要完成的工作，Agent 会在所选项目中推进。</p>
        <div className="mb-3 mt-7 flex items-center justify-between"><label htmlFor="task-prompt" className="text-[14px] font-medium">任务描述</label><span className="text-[11px] text-faint">设计预览 · 不调用模型</span></div>
        <div className="rounded-control border border-border bg-input focus-within:border-primary/60">
          <textarea id="task-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：参考 Proma 重构工作台，保留多项目、协作 Agent 和文件审查能力…" className="block h-[155px] w-full bg-transparent p-4 text-[15px] leading-7 outline-none placeholder:text-faint" />
          <div className="flex h-11 items-center gap-2 border-t border-line px-3 text-[12px] text-muted">
            <button onClick={() => setReference(!reference)} className="flex items-center gap-1.5 rounded-control px-2 py-1 hover:bg-hover"><span className="icon-[lucide--paperclip] size-4" />{reference ? '移除示例引用' : '添加上下文'}</button>
            {reference && <span className="flex items-center gap-1 rounded-control bg-control/60 px-2 py-1 text-[11px] text-primary"><span className="icon-[lucide--file-code-2] size-3" />Sidebar.tsx</span>}
            <span className="ml-auto text-[11px]">@ 文件 / 技能</span>
          </div>
        </div>
        <div className="mb-7 mt-3 flex items-center gap-2">
          <span className="mr-1 text-[12px] text-faint">从这里开始</span>
          {starters.map((item) => <button key={item.title} onClick={() => setPrompt(item.prompt)} className="flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-[12px] text-muted hover:bg-hover"><span className={`${item.icon} size-3.5`} />{item.title}</button>)}
        </div>
        <section className="border-t border-line py-5">
          <h2 className="mb-4 text-[14px] font-medium">工作环境</h2>
          <div className="grid grid-cols-2 gap-5">
            <label className="block"><span className="mb-2 block text-[12px] text-muted">项目</span><select aria-label="选择项目" value={project} onChange={(event) => setProject(event.target.value)} className="h-10 w-full rounded-control border border-border bg-surface px-3 text-[13px]">{projects.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
            <div>
              <span className="mb-2 block text-[12px] text-muted">工作分支</span>
              <button className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-control border border-border px-3 text-left text-[13px] hover:bg-hover" onClick={() => setWorktree(!worktree)}>
                <span className="icon-[lucide--git-branch] size-4 shrink-0 text-muted" />
                <span>{worktree ? 'enso/ui-rework' : 'main'}</span>
                <span className="ml-auto text-[11px] text-muted">{worktree ? '独立工作树' : '当前工作树'}</span>
              </button>
            </div>
          </div>
          <button role="switch" aria-checked={worktree} onClick={() => setWorktree(!worktree)} className="mt-4 flex w-full items-center gap-3 rounded-control py-1 text-left"><span className={`flex h-[18px] w-8 shrink-0 items-center rounded-full px-[3px] ${worktree ? 'justify-end bg-surface-foreground' : 'justify-start bg-border'}`}><span className="size-3 rounded-full bg-surface" /></span><span className="text-[12px] text-muted">创建独立 Git Worktree，隔离并行任务的文件改动</span></button>
        </section>
        <section className="border-t border-line py-5">
          <h2 className="mb-4 text-[14px] font-medium">Agent 配置</h2>
          <div className="grid grid-cols-2 gap-5">
            <label><span className="mb-2 block text-[12px] text-muted">模型</span><select aria-label="任务模型" value={model} onChange={(event) => setModel(event.target.value)} className="h-10 w-full rounded-control border border-border bg-surface px-3 text-[13px]">{models.map((name) => <option key={name}>{name}</option>)}</select></label>
            <label><span className="mb-2 block text-[12px] text-muted">审批模式</span><select aria-label="任务审批模式" value={approval} onChange={(event) => setApproval(event.target.value)} className="h-10 w-full rounded-control border border-border bg-surface px-3 text-[13px]"><option>自动接受编辑</option><option>全程审批</option><option>完全放行</option></select></label>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted">{approval === '全程审批' ? '所有工具操作都需要你确认后执行。' : approval === '完全放行' ? '允许 Agent 自主执行操作，请仅在可信项目中使用。' : '文件编辑自动执行，命令与高风险操作仍需确认。'}</p>
        </section>
        <div className="mt-2 flex items-center gap-3 border-t border-line pt-5">
          <span className="flex items-center gap-1.5 text-[11px] text-muted"><span className="icon-[lucide--lock-keyhole] size-3" />配置仅用于本次预览</span>
          <Link to="/" className="ml-auto rounded-control px-4 py-2 text-[13px] text-muted hover:bg-hover">取消</Link>
          <button disabled={!prompt.trim()} onClick={() => { setTask(prompt); setNotice(`已创建“${project}”的演示任务。未调用模型，也未创建真实工作树。`); navigate('/'); }} className="flex h-9 items-center gap-2 rounded-control bg-surface-foreground px-4 text-[13px] text-surface hover:opacity-90 disabled:bg-control disabled:text-muted">创建任务<span className="icon-[lucide--arrow-right] size-3.5" /></button>
        </div>
      </div>
    </div>
  );
}
