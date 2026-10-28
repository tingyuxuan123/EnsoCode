export const frame = { width: 1440, height: 900, title: "Bot · 搜索成员、群聊与消息" };

import { Link } from 'react-router';

const hits = [
  { kind: '群聊', title: '竞品周报', meta: '4 名成员 · 第 43 周', icon: 'icon-[lucide--users]' },
  { kind: '成员', title: '小满', meta: '研究员 · Gemini 2.5 Pro', icon: 'icon-[lucide--user]' },
  { kind: '消息', title: '检索到 12 条相关更新，其中 4 条需要确认口径。', meta: '竞品周报 / 小满 · 今天 09:41', icon: 'icon-[lucide--message-square]' },
  { kind: '任务', title: '#12 整理三家竞品本周动作', meta: '进行中 · 小满 · 卡住等你回复', icon: 'icon-[lucide--square-kanban]' },
  { kind: '例程', title: '每日竞品快照', meta: '工作日 09:00 · 下次明天 09:00', icon: 'icon-[lucide--alarm-clock]' },
];

/** Bot 搜索（bots/BotSearchDialog.tsx）：成员 / 群聊 / 消息 / 任务 / 例程，最近搜索与无结果 */
export default function BotSearch() {
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center bg-panel/40 px-6 py-10">
      <div className="w-full max-w-[620px] overflow-hidden rounded-control border border-border bg-surface shadow-[0_10px_30px_rgba(20,40,60,0.14)]">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <span className="icon-[lucide--search] size-4 text-muted" />
          <input autoFocus defaultValue="口径" aria-label="搜索" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
          <span className="rounded border border-border px-1 text-[11px] text-faint">Esc</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1">
          <p className="px-3 pb-1 pt-1.5 text-[11px] text-faint">5 条结果</p>
          {hits.map((hit) => (
            <Link key={hit.title} to="/bot-chat" className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-hover">
              <span className={`${hit.icon} size-4 shrink-0 text-muted`} />
              <span className="min-w-0 flex-1"><span className="block truncate">{hit.title}</span><span className="block truncate text-[11px] text-faint">{hit.meta}</span></span>
              <span className="shrink-0 rounded-[4px] bg-control px-1 text-[10px] text-muted">{hit.kind}</span>
            </Link>
          ))}
          <div className="mt-1 border-t border-line px-3 py-2 text-[11px]">
            <p className="text-faint">最近搜索</p>
            <div className="mt-1 flex flex-wrap gap-1.5">{['口径', '周报模板', '阿米预算', '浏览历史'].map((item) => <span key={item} className="rounded-control border border-border px-2 py-0.5 text-muted">{item}</span>)}</div>
            <p className="mt-2 text-faint">没有匹配的会话时显示「没有匹配的会话」，并提示换关键词或切到「已归档」。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
