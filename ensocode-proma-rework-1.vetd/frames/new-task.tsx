export const frame = { width: 1440, height: 900, title: "新建任务 · 空会话" };

import { useState } from 'react';
import { Link } from 'react-router';
import { Composer } from '../components/Composer';
import { CoworkerTabs } from '../components/Conversation';
import { useWorkbench } from '../components/Workbench';

const suggestions = [
  { icon: 'icon-[lucide--compass]', title: '梳理项目结构', hint: '入口、模块划分与关键依赖', prompt: '带我过一遍这个项目的结构：入口、模块划分和关键依赖。' },
  { icon: 'icon-[lucide--bug]', title: '排查潜在问题', hint: '可疑逻辑与未处理的边界', prompt: '审查这个项目，找出潜在 bug、可疑逻辑和未处理的边界情况，按严重程度列出。' },
  { icon: 'icon-[lucide--flask-conical]', title: '补充单元测试', hint: '覆盖缺少测试的核心模块', prompt: '找出缺少测试的核心模块，为它们补充单元测试。' },
  { icon: 'icon-[lucide--history]', title: '总结最近改动', hint: '基于 git log 的摘要', prompt: '基于 git log 总结这个仓库最近的改动。' },
];

/**
 * 新建任务不是一个表单页：真实应用是在当前（或第一个）项目直接开一个新会话，
 * 空会话给项目名 + 建议 + 输入框。⌘N 与侧栏「新建任务」是同一个动作。
 */
export default function NewTaskScreen() {
  const { task } = useWorkbench();
  const [tab, setTab] = useState('main');
  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <CoworkerTabs active={tab} onSelect={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-10">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">
            <span className="icon-[lucide--folder-open] size-3.5" />
            EnsoCode
            <span className="icon-[lucide--chevron-right] size-3" />
            新会话
          </div>
          <h1 className="text-[22px] font-semibold">开始一项新任务</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-muted">描述你要完成的工作，Agent 会在 <span className="text-surface-foreground">EnsoCode</span> 里推进；模型与审批档位可以在输入框里改。</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {suggestions.map((item) => (
              <button key={item.title} className="flex items-start gap-2.5 rounded-control border border-border/70 bg-panel/40 px-3 py-2.5 text-left hover:bg-hover">
                <span className={`${item.icon} size-3.5 shrink-0 text-primary`} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">{item.title}</span>
                  <span className="block truncate text-[11px] text-muted">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-control border border-line px-3 py-2 text-[11.5px] leading-5 text-muted">
            当前项目 <span className="text-surface-foreground">EnsoCode</span> · 工作树 main · 默认模型跟随分组，再跟随全局默认。想换目录或走 SSH？<Link to="/project-settings" className="text-primary">项目设置</Link>
          </div>
        </div>
      </div>
      <div className="shrink-0 pb-3 pt-1">
        <div className="mx-auto w-full max-w-[720px] px-6">
          <Composer started={false} onSend={() => undefined} initial={task} />
        </div>
      </div>
    </div>
  );
}
