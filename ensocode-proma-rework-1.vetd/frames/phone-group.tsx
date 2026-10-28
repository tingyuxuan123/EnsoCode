export const frame = { width: 390, height: 844, title: "手机 · 群聊话题、发件箱与交付物" };

import { Link } from 'react-router';
import { Avatar } from '../components/bot/BotShell';
import { members } from '../components/bot/data';

/**
 * 手机群聊（packages/phone GroupChatScreen + GroupThreadSwitcher + OutboxBar + BotArtifacts）：
 * 话题切换与新建、消息与任务事件、排队发件箱、交付物预览、成员抽屉入口。
 */
export default function PhoneGroup() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Link to="/phone-bots" className="flex size-8 items-center justify-center text-muted"><span className="icon-[lucide--chevron-left] size-4" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">竞品周报</p>
          <p className="truncate text-[11px] text-muted">4 名成员 · 群主 阿岚 · 智能选人</p>
        </div>
        <button title="成员与群信息" className="flex size-8 items-center justify-center rounded-full bg-control/60 text-muted"><span className="icon-[lucide--users] size-4" /></button>
      </div>
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 [scrollbar-width:none]">
        {[['t1', '第 43 周', true], ['t2', '第 42 周', false], ['t3', '渠道对比', false]].map(([id, name, active]) => (
          <button key={String(id)} className={`flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] ${active ? 'bg-selected font-medium text-surface-foreground' : 'bg-control/50 text-muted'}`}>
            <span className="icon-[lucide--hash] size-3" />
            {name}
            {id === 't3' && <span className="size-1.5 rounded-full bg-primary" />}
          </button>
        ))}
        <button title="新话题" className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted"><span className="icon-[lucide--plus] size-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <div className="ml-auto max-w-[85%] rounded-[14px] rounded-br-[4px] bg-panel px-3 py-2 text-[13px] leading-5">这周竞品周报，重点看三家在「多成员协作」上的动作。</div>
        <div className="flex gap-2">
          <Avatar member={members[0]} size="sm" />
          <div className="min-w-0 max-w-[80%]">
            <p className="mb-0.5 text-[11px] text-faint">阿岚 · 09:12</p>
            <div className="rounded-[14px] rounded-bl-[4px] bg-control/50 px-3 py-2 text-[13px] leading-5">拆成三块：竞品动作、我们对比、可发版本。小满先检索，老周补数据。</div>
          </div>
        </div>
        <div className="rounded-[10px] border border-line px-2.5 py-1.5 text-[11.5px]">
          <span className="text-faint">任务 #12</span>
          <span className="ml-1.5 font-medium">整理三家竞品本周动作</span>
          <span className="ml-1 text-muted">→ 小满</span>
          <span className="ml-1 rounded-[4px] bg-primary-soft px-1 text-primary">进行中</span>
        </div>
        <div className="flex gap-2">
          <Avatar member={members[1]} size="sm" />
          <div className="min-w-0 max-w-[80%]">
            <p className="mb-0.5 text-[11px] text-faint">小满 · 09:41 · 回复中</p>
            <div className="rounded-[14px] rounded-bl-[4px] bg-control/50 px-3 py-2 text-[13px] leading-5">检索到 12 条相关更新，其中 4 条需要确认口径，已投到看板 #12。</div>
          </div>
        </div>
        <div className="rounded-[10px] border border-warning/40 bg-warning-soft px-2.5 py-2 text-[11.5px] leading-5">
          小满 需要你处理：要不要把上一代产品也算进来？<span className="ml-1 text-primary">回复</span>
        </div>
        <div className="rounded-[10px] border border-line px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11.5px]"><span className="icon-[lucide--package] size-3.5 text-muted" />交付物</div>
          <div className="mt-1.5 space-y-1">
            {['reports/43w-draft.md · 12 KB', 'metrics/43w.csv · 3 KB'].map((name) => (
              <div key={name} className="flex items-center gap-1.5 rounded-control bg-panel/60 px-2 py-1 font-mono text-[11px]"><span className="icon-[lucide--file-text] size-3 shrink-0 text-faint" /><span className="min-w-0 flex-1 truncate">{name}</span><span className="shrink-0 text-[10px] text-primary">预览</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 rounded-control border border-border/70 bg-panel/50 px-2.5 py-1 text-[11px]">
          <span className="text-faint">排队</span>
          <span className="min-w-0 flex-1 truncate">顺便把口径那条也写进周报里</span>
          <span className="flex shrink-0 items-center gap-1 text-muted"><span className="icon-[lucide--images] size-3" />1</span>
          <span className="icon-[lucide--pencil] size-3" />
          <span className="icon-[lucide--x] size-3" />
        </div>
        <div className="flex items-end gap-2 rounded-[14px] border border-border bg-input px-2 py-1.5">
          <span className="icon-[lucide--at-sign] size-4 shrink-0 text-muted" />
          <textarea rows={1} placeholder="@ 成员，或直接说…" aria-label="群聊输入" className="max-h-20 min-h-8 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 outline-none placeholder:text-faint" />
          <button className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground"><span className="icon-[lucide--arrow-up] size-4" /></button>
        </div>
        <p className="mt-1 text-center text-[11px] text-faint">不 @ 时智能选出最合适的成员回复</p>
      </div>
    </div>
  );
}
