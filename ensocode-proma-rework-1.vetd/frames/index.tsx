export const frame = { width: 1440, height: 900, title: "对话工作台" };

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Composer } from '../components/Composer';
import { added, agents, changes, removed, taskTitle } from '../components/data';
import { useWorkbench } from '../components/Workbench';
import { TaskDock, type DockView } from '../components/TaskDock';

export default function WorkbenchScreen({ initialDock = null }: { initialDock?: DockView }) {
  const { task, setNotice, setInspectorTab, setInspectorOpen } = useWorkbench();
  const [agent, setAgent] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-[43px] shrink-0 items-center gap-1 border-b border-line px-5">
        {agents.map((item, index) => (
          <button key={item.name} className={`relative flex h-full items-center gap-1.5 px-3 text-[12px] ${agent === index ? 'text-surface-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-primary' : 'text-muted hover:bg-hover'}`} onClick={() => setAgent(index)}>
            <span className={`${item.icon} size-3.5`} />
            {item.name}
            {index > 0 && <span className="size-[4px] rounded-full bg-success" />}
          </button>
        ))}
        <button aria-label="添加协作 Agent" title="添加协作 Agent" onClick={() => setNotice('设计预览：协作 Agent 使用独立上下文，长期协作者拥有自己的页签。')} className="ml-1 flex size-6 items-center justify-center text-faint hover:text-surface-foreground"><span className="icon-[lucide--plus] size-3.5" /></button>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-faint"><span className="icon-[lucide--git-branch] size-3" />main</div>
      </header>
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-9 pb-5 pt-6">
        {agent === 0 ? (
          <div className="mx-auto max-w-[820px]">
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 text-[12px]"><span className="font-medium">你</span><span className="text-faint">14:32</span><span className="ml-auto text-[11px] text-faint">示例会话</span></div>
              <p className="rounded-control bg-panel px-4 py-3 text-[14px] leading-6">{task || '参考当前 Proma 的布局，把 EnsoCode 的工作台整理得更清爽一些。保留项目会话、协作 Agent 和文件审查，不改现有功能。'}</p>
            </div>
            <div className="mb-3 flex items-center gap-2 text-[12px]"><span className="icon-[lucide--circle-dashed] size-[17px]" /><span className="font-medium">EnsoCode</span><span className="text-faint">14:33</span></div>
            <p className="text-[15px] leading-[27px]">我会先统一工作区的结构与视觉层级，再整理侧栏、输入区和改动面板。现有会话、审批和协作能力保持不变。</p>
            <button className="my-3 flex items-center gap-2 text-[12px] text-muted" aria-expanded={stepsOpen} onClick={() => setStepsOpen(!stepsOpen)}>
              <span className="icon-[lucide--circle-check] size-3.5 text-success" />
              已完成 3 项界面调整
              <span className={`${stepsOpen ? 'icon-[lucide--chevron-up]' : 'icon-[lucide--chevron-down]'} size-3`} />
            </button>
            {stepsOpen && <div className="mb-4 ml-1 border-l border-border pl-4 text-[12px] leading-7 text-muted"><p>读取现有工作区布局与主题变量</p><p>统一项目侧栏、导航与输入区域</p><p>整理改动审查和界面检查清单</p></div>}
            <h1 className="mb-3 mt-5 text-[19px] font-semibold">工作台结构已整理</h1>
            <p className="mb-4 text-[14px] leading-[26px] text-muted">让对话成为主线，把项目上下文和交付物留在两侧。减少嵌套卡片，用背景层次和细分隔线代替厚重边框。</p>
            <ul className="space-y-2.5 text-[14px] leading-6">
              <li className="flex gap-3"><span className="mt-2.5 size-[4px] shrink-0 rounded-full bg-border" /><span><strong className="font-medium">导航更清晰</strong><span className="text-muted">：项目和会话分组排列，全局工具收进左侧图标栏。</span></span></li>
              <li className="flex gap-3"><span className="mt-2.5 size-[4px] shrink-0 rounded-full bg-border" /><span><strong className="font-medium">内容更专注</strong><span className="text-muted">：正文保留阅读宽度，执行过程默认收起，协作结果独立查看。</span></span></li>
              <li className="flex gap-3"><span className="mt-2.5 size-[4px] shrink-0 rounded-full bg-border" /><span><strong className="font-medium">审查不离开工作区</strong><span className="text-muted">：文件、会话改动和终端统一在右侧切换。</span></span></li>
            </ul>
            <div className="mb-4 mt-5 rounded-control border border-line">
              <div className="flex h-9 items-center gap-2 bg-panel/60 px-3 text-[12px]"><span className="icon-[lucide--files] size-3.5 text-muted" /><span className="font-medium">本次改动</span><span className="ml-auto text-muted">{changes.length} 个文件</span><span className="text-success">+{added}</span><span className="text-danger">−{removed}</span></div>
              {changes.map((file) => <Link key={file.name} to="/review" className="flex h-9 items-center gap-2 border-t border-line px-3 text-[12px] hover:bg-hover"><span className="icon-[lucide--file-code-2] size-3.5 text-primary" /><span>{file.name}</span><span className="ml-auto text-success">+{file.added}</span><span className="text-danger">−{file.removed}</span><span className="icon-[lucide--chevron-right] ml-1 size-3 text-muted" /></Link>)}
            </div>
            <div className="flex items-center gap-2 text-[12px]"><span className="icon-[lucide--circle-check] size-3.5 text-success" /><span className="text-muted">类型、样式与界面检查已通过</span><span className="text-faint">· 演示状态</span></div>
            <div className="mt-4 flex items-center gap-4 text-[12px]">
              <Link to="/review" className="flex items-center gap-1 text-primary">查看改动<span className="icon-[lucide--arrow-up-right] size-3.5" /></Link>
              <button onClick={() => { setInspectorOpen(true); setInspectorTab('terminal'); }} className="text-muted hover:text-surface-foreground">查看终端</button>
              <button onClick={() => setNotice('设计预览：复制内容仅作为界面交互示例，不会改动工作区文件。')} aria-label="复制回复" title="复制回复" className="ml-auto text-faint"><span className="icon-[lucide--copy] size-3.5" /></button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[820px]">
            <div className="mb-5 flex items-center gap-2 text-[12px]"><span className={`${agents[agent].icon} size-4 text-muted`} /><span>{agents[agent].name}</span><span className="ml-auto text-success">已完成 · 示例</span></div>
            <h1 className="mb-4 text-[20px] font-semibold">{agent === 1 ? '布局与主题调整完成' : '界面回归检查完成'}</h1>
            <p className="mb-6 text-[15px] leading-7">{agent === 1 ? '统一蓝灰浅色主题、6px 圆角和左右分栏。所有布局遵循共享令牌，不触碰会话与 Agent 运行逻辑。' : '检查了项目树展开、协作页签、输入框、文件面板与改动审查的页面状态，未发现遮挡或异常换行。'}</p>
            <div className="space-y-3 border-l border-border pl-4 text-[13px] leading-6 text-muted"><p>范围：当前工作台界面</p><p>交付：{agent === 1 ? '统一的界面层级与组件样式' : '页面检查清单与交互检查记录'}</p><p>边界：设计稿演示，不代表真实检查执行。</p></div>
            <button onClick={() => setAgent(0)} className="mt-6 text-[13px] text-primary">返回主会话 →</button>
          </div>
        )}
        {messages.map((message, index) => <div key={index} className="mx-auto mt-6 max-w-[820px]"><div className="mb-2 text-[12px] font-medium">你</div><p className="rounded-control bg-panel px-4 py-3 text-[14px] leading-6">{message}</p><p className="mt-3 text-[12px] text-muted">已在设计预览中记录。未发送到模型。</p></div>)}
      </div>
      <div className="mx-5 flex shrink-0 items-center gap-2 border-t border-line pt-2 text-[11px] text-muted">
        <span className="icon-[lucide--git-branch] size-3" />
        main
        <span className="mx-1 text-border">·</span>
        <span className="min-w-0 flex-1 truncate">{taskTitle}</span>
        <span className="whitespace-nowrap">界面调整完成 · 等待验收</span>
      </div>
      <TaskDock initial={initialDock} />
      <Composer onSend={(text) => setMessages([...messages, text])} />
    </div>
  );
}
