export const frame = { width: 1440, height: 900, title: "Bot · 成员与群组记忆" };

import { useState } from 'react';
import { Avatar } from '../components/bot/BotShell';
import { members } from '../components/bot/data';

const spaces = [
  { id: 's1', name: '竞品事实', count: 18, items: [['三家的多成员协作都在 8 月后上线', '2026-08-14 · 小满'], ['A 家的定价页换了三层结构', '2026-09-02 · 小满'], ['B 家把团队能力放进专业版', '2026-09-21 · 老周']] },
  { id: 's2', name: '写作偏好', count: 9, items: [['周报先结论后依据', '2026-07-30 · 阿岚'], ['避免形容词堆叠', '2026-08-11 · 阿米']] },
  { id: 's3', name: '历史结论', count: 15, items: [['第 42 周：功能差距缩小到 1 个季度', '2026-10-17 · 阿岚']] },
];

/** 成员记忆（bots/MemorySpaceList.tsx + NotesEditor.tsx + MemoryWriteCard.tsx）：核心笔记、记忆空间、写入审批 */
export default function BotMemory() {
  const [space, setSpace] = useState('s1');
  const [notes, setNotes] = useState('周报口径以自然周为准；渠道数据以老周的 CSV 为唯一来源。');
  const active = spaces.find((item) => item.id === space)!;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <Avatar member={members[0]} size="sm" />
        <h1 className="text-[15px] font-medium">记忆 · 阿岚</h1>
        <span className="text-[12px] text-muted">{members[0].memory} 条记忆 · 群组记忆与成员记忆分开存放</span>
        <span className="ml-auto text-[11px] text-faint">写入需要你审批</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] shrink-0 border-r border-line px-3 py-3">
          <p className="px-1 text-[11px] text-faint">记忆空间</p>
          {spaces.map((item) => (
            <button key={item.id} onClick={() => setSpace(item.id)} className={`mt-1 flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-control px-2 text-[12.5px] ${space === item.id ? 'bg-selected font-medium' : 'text-muted hover:bg-hover'}`}>
              <span className="icon-[lucide--folder] size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate whitespace-nowrap">{item.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-faint">{item.count}</span>
            </button>
          ))}
          <p className="mt-3 px-1 text-[11px] text-faint">群组记忆</p>
          <button className="mt-1 flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-control px-2 text-[12.5px] text-muted hover:bg-hover"><span className="icon-[lucide--users] size-3.5" /><span className="flex-1">竞品周报</span><span className="text-[11px] text-faint">26</span></button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[13px] font-medium">{active.name}</p>
          <div className="mt-2 space-y-1.5">
            {active.items.map(([text, meta]) => (
              <div key={text} className="rounded-control border border-line px-3 py-2">
                <p className="text-[12.5px] leading-5">{text}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-faint"><span>{meta}</span><button className="ml-auto text-muted hover:text-danger">删除</button><button className="text-muted hover:text-surface-foreground">编辑</button></div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-control border border-line p-3">
            <p className="text-[12.5px] font-medium">核心笔记</p>
            <p className="mt-0.5 text-[11px] text-muted">每次新对话自动带上。整理记忆后，重要的偏好和事实会自动汇总到这里。</p>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-2 block w-full resize-none rounded-control border border-border bg-input p-2.5 text-[12.5px] leading-6 outline-none focus:border-primary/60" />
            <div className="mt-1.5 flex justify-end gap-2"><button className="px-2 py-1 text-[11.5px] text-muted">放弃修改</button><button className="rounded-control bg-surface-foreground px-3 py-1 text-[11.5px] text-surface">保存</button></div>
          </div>
          <div className="mt-3 rounded-control border border-primary/40 bg-primary-soft/30 px-3 py-2">
            <p className="text-[12px] font-medium">待审阅的写入 · 老周</p>
            <p className="mt-0.5 text-[12px] leading-5">「周报口径以自然周为准」 → 写入群组记忆「竞品周报」</p>
            <div className="mt-1.5 flex gap-2 text-[11.5px]"><button className="rounded-control bg-primary px-2.5 py-1 text-primary-foreground">写入</button><button className="rounded-control px-2.5 py-1 text-muted hover:bg-hover">忽略</button></div>
          </div>
          <p className="mt-3 text-[11px] text-muted">暂无对话记录的成员空间会显示「还没有记忆」。</p>
        </div>
      </div>
    </div>
  );
}
