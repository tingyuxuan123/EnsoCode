export const frame = { width: 1440, height: 900, title: "会话内查找与轮次导航" };

import { useState } from 'react';
import { IconButton } from '../components/panel/PanelUI';
import WorkbenchScreen from './index';

/** ⌘F：匹配高亮、上一个/下一个、无匹配；右侧轮次导航（NavRail）悬停预览并跳转 */
function FindBar() {
  const [q, setQ] = useState('状态点');
  const [hit, setHit] = useState(2);
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[12px]">
      <span className="icon-[lucide--search] size-3.5 text-muted" />
      <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索消息..." aria-label="搜索消息" className="h-6 w-56 rounded-control border border-border bg-surface px-2 text-[12px] outline-none" />
      <span className="tabular-nums text-muted">{hit}/6</span>
      <IconButton icon="icon-[lucide--chevron-up]" label="上一个" onClick={() => setHit(Math.max(1, hit - 1))} />
      <IconButton icon="icon-[lucide--chevron-down]" label="下一个" onClick={() => setHit(Math.min(6, hit + 1))} />
      <span className="ml-auto text-[11px] text-faint">匹配正文与工具输出；轮次导航在右侧，悬停可预览</span>
    </div>
  );
}

/** 右侧轮次导航（NavRail）：每条用户消息一个刻度，悬停出预览 */
function NavRail() {
  return (
    <div className="absolute right-1 top-20 z-10 flex w-[168px] flex-col items-end gap-1.5">
      {[['14:32', '参考当前 Proma 的布局，把 EnsoCode 的工作台整理得更清爽一些。'], ['14:51', '再把状态栏字段做成可排序的，默认不要轮询额度。'], ['15:04', '侧栏状态点要能看出等待审批和运行中。']].map(([time, text], index) => (
        <div key={time} className="group flex items-center gap-1">
          <span className={`hidden max-w-[140px] truncate rounded-control border border-border bg-surface px-2 py-1 text-[11px] group-hover:block ${index === 1 ? 'block' : ''}`}>{text}</span>
          <span className={`h-[2px] shrink-0 rounded-full ${index === 1 ? 'w-5 bg-primary' : 'w-3 bg-border'}`} title={time} />
        </div>
      ))}
    </div>
  );
}

export default function ChatFindFrame() {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <WorkbenchScreen running={false} topBar={<FindBar />} />
      <NavRail />
    </div>
  );
}
