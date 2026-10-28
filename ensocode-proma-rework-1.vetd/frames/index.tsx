export const frame = { width: 1440, height: 900, title: "对话工作台" };

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Composer } from '../components/Composer';
import { AssistantActions, AssistantHeader, CoworkerTabs, TimelineEvent, TurnFilesCard, UserMessage, WorkedRow } from '../components/Conversation';
import { coworkers } from '../components/data';
import { TaskDock, type DockView } from '../components/TaskDock';
import { useWorkbench } from '../components/Workbench';

export type WorkbenchProps = {
  initialDock?: DockView;
  /** 输入框上方的运行条（审批、提问、计划、目标、队列……），按真实 ChatView 的顺序传入 */
  bars?: ReactNode;
  running?: boolean;
  locked?: boolean;
  queuedCount?: number;
  /** 替换默认时间线（例如计划模式会话） */
  timeline?: ReactNode;
  showDock?: boolean;
  /** 会话头下方的附加条（例如会话内查找条） */
  topBar?: ReactNode;
};

function DefaultTimeline({ running }: { running: boolean }) {
  const { task } = useWorkbench();
  return (
    <>
      <UserMessage>{task || '参考当前 Proma 的布局，把 EnsoCode 的工作台整理得更清爽一些。保留项目会话、协作 Agent 和文件审查，不改现有功能。'}</UserMessage>
      <AssistantHeader />
      <WorkedRow />
      <h2 className="mb-3 text-[18px] font-semibold">工作台结构已整理</h2>
      <p className="mb-3 text-[15px] leading-[27px]">让对话成为主线，把项目上下文和交付物放在两侧；用背景层次和 1px 细线代替厚重边框。</p>
      <ul className="space-y-2 text-[14px] leading-6">
        <li className="flex gap-3"><span className="mt-2.5 size-[4px] shrink-0 rounded-full bg-border" /><span><strong className="font-medium">侧栏</strong><span className="text-muted">：保留分组标签、活跃中 / 已置顶、项目树与节点切换。</span></span></li>
        <li className="flex gap-3"><span className="mt-2.5 size-[4px] shrink-0 rounded-full bg-border" /><span><strong className="font-medium">输入区</strong><span className="text-muted">：预设、工作区、计划、审批档位和模型集中在一行，运行条按优先级叠在上方。</span></span></li>
        <li className="flex gap-3"><span className="mt-2.5 size-[4px] shrink-0 rounded-full bg-border" /><span><strong className="font-medium">右侧面板</strong><span className="text-muted">：文件、改动、终端、浏览器、旁路、代理和工作流都是可停靠标签。</span></span></li>
      </ul>
      <TurnFilesCard />
      <pre className="mb-3 overflow-auto rounded-control bg-code px-3 py-2.5 font-mono text-[12px] leading-5"><code className="bg-transparent p-0">{'$ pnpm typecheck && pnpm lint && pnpm test\n✓ 412 tests passed'}</code></pre>
      <AssistantActions />
      <TimelineEvent icon="icon-[lucide--archive-restore]">上下文已压缩（压缩前 162K tokens）· 点开查看摘要</TimelineEvent>
      <UserMessage time="14:51">再把状态栏字段做成可排序的，默认不要轮询额度。</UserMessage>
      <AssistantHeader time="14:51" />
      <WorkedRow running={running} />
      {running && <p className="text-[15px] leading-[27px] text-muted">正在把 StatsLine 的字段配置接到 statusLineSegments……</p>}
    </>
  );
}

function CoworkerTimeline({ id }: { id: string }) {
  const member = coworkers.find((item) => item.id === id);
  return (
    <>
      <div className="mb-4 flex items-center gap-2 rounded-control bg-panel/60 px-3 py-2 text-[12px] text-muted">
        <span className="icon-[lucide--bot] size-3.5" />
        {member?.name} · worker · Claude Sonnet 4.5
        <span className="ml-auto">{member?.status}</span>
      </div>
      <div className="mb-6 flex flex-col items-end"><div className="max-w-[86%] rounded-control bg-panel px-4 py-2.5 text-[14px] leading-6"><span className="mb-1 block text-[11px] text-faint">来自主 agent</span>检查侧栏、输入区与右侧面板在 1280 宽度下是否有截断，列出问题位置。</div></div>
      <AssistantHeader name={member?.name ?? ''} />
      <WorkedRow />
      <p className="text-[15px] leading-[27px]">{id === 'cw2' ? '需要运行一次完整测试才能确认回归，已发起审批请求。' : '已完成样式调整，等待主会话的下一条消息。'}</p>
    </>
  );
}

export default function WorkbenchScreen({ initialDock = null, bars, running = true, locked = false, queuedCount = 0, timeline, showDock = true, topBar }: WorkbenchProps) {
  const { chatWide } = useWorkbench();
  const [tab, setTab] = useState('main');
  const [messages, setMessages] = useState<string[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  const column = chatWide ? 'mx-auto w-full max-w-none px-8' : 'mx-auto w-full max-w-[760px] px-6';
  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <CoworkerTabs active={tab} onSelect={setTab} />
      {topBar}
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto pb-4 pt-6">
        <div className={column}>
          {tab === 'main' ? (timeline ?? <DefaultTimeline running={running} />) : <CoworkerTimeline id={tab} />}
          {messages.map((message, index) => (
            <div key={index} className="mt-6">
              <UserMessage time="刚刚">{message}</UserMessage>
              <p className="-mt-3 text-right text-[11px] text-faint">{running ? '已排队，本轮结束后发送（设计预览）' : '已在设计预览中记录，未发送到模型'}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 pb-3 pt-1">
        <div className={column}>
          {showDock && tab === 'main' && <TaskDock initial={initialDock} />}
          {tab === 'main' && bars}
          <Composer running={running && tab === 'main'} locked={locked} queuedCount={queuedCount} onSend={(text) => setMessages([...messages, text])} />
        </div>
      </div>
    </div>
  );
}
