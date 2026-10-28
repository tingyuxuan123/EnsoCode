export const frame = { width: 1440, height: 900, title: "Bot · 例程与定时任务" };

import { useState } from 'react';
import { routines } from '../components/bot/data';

/** 例程（bots/RoutineList.tsx）：简易日程 / cron、目标会话、执行成员、补跑、提议审批、启停、立即运行/试跑、历史 */
export default function BotRoutines() {
  const [open, setOpen] = useState('');
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--alarm-clock] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">例行任务</h1>
        <span className="text-[12px] text-muted">按时间自动执行，结果投递到指定聊天</span>
        <button className="ml-auto h-7 rounded-control bg-surface-foreground px-2.5 text-[12px] text-surface">新建例行任务</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-[860px]">
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <span className="text-faint">cron：分 时 日 月 周，本地时间</span>
            <span className="ml-auto text-muted">4 个 · 2 个已启用</span>
          </div>
          <div className="divide-y divide-line rounded-control border border-line">
            {routines.map((routine) => (
              <div key={routine.id}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`${routine.mode === '手动' ? 'icon-[lucide--hand]' : 'icon-[lucide--alarm-clock]'} size-3.5 shrink-0 ${routine.state === '已启用' ? 'text-primary' : 'text-muted'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{routine.title}</span><span className="rounded-[4px] bg-control px-1 text-[10px] text-muted">{routine.mode}</span><span className={`rounded-[4px] px-1 text-[10px] ${routine.state === '已启用' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{routine.state}</span></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      <span>{routine.schedule}</span><span className="text-border">·</span><span>{routine.next}</span><span className="text-border">·</span><span>由 {routine.member} 执行</span><span className="text-border">·</span><span>投递到「{routine.chat}」</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">上次 {routine.last}{routine.missed ? ` · 错过 ${routine.missed} 次` : ''}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-[11.5px]">
                    <button onClick={() => setOpen(open === routine.id ? '' : routine.id)} className="rounded-control px-2 py-1 text-muted hover:bg-hover">{open === routine.id ? '收起' : '历史'}</button>
                    <button className="rounded-control border border-border px-2 py-1 hover:bg-hover">立即运行</button>
                    <button className="rounded-control px-2 py-1 text-muted hover:bg-hover">编辑</button>
                    <button className="rounded-control px-2 py-1 text-danger">删除</button>
                  </div>
                </div>
                {open === routine.id && (
                  <div className="border-t border-line bg-panel/40 px-4 py-2 text-[11.5px] leading-6">
                    <p className="text-faint">运行记录</p>
                    <p>今天 09:00 · 成功 · 抓取 3 个站点 · 用时 42s · <button className="text-primary">打开聊天</button></p>
                    <p>昨天 09:00 · 成功 · 抓取 3 个站点 · 用时 38s</p>
                    <p>10 月 25 日 09:00 · 失败 · 目标聊天已不存在</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-5">
            <p className="font-medium">小满 提议建立例程，等待你批准</p>
            <p className="mt-0.5 text-muted">每周一 09:00 抓取竞品更新并投递到「竞品周报」。<button className="ml-2 text-primary">批准</button><button className="ml-2 text-danger">拒绝</button></p>
          </div>
          <p className="mt-2 text-[11px] text-muted">补跑：错过的定时任务会在下次启动时补一次，或按「不补跑」跳过。</p>
        </div>
      </div>
    </div>
  );
}
