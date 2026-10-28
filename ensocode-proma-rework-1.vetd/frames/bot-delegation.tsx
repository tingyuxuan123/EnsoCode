export const frame = { width: 1440, height: 900, title: "Bot · 委派与执行记录" };

import { Link } from 'react-router';
import { runs } from '../components/bot/data';

const tone: Record<string, string> = { 已完成: 'text-success', 失败: 'text-danger', 卡住了: 'text-warning', 已取消: 'text-faint', 中断: 'text-danger', 进行中: 'text-primary' };

/** 委派记录（bots/TaskRuns.tsx）：发起、状态、阻塞问题、失败原因、重试/改派/取消、子会话历史 */
export default function BotDelegation() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--git-branch] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">委派与执行记录</h1>
        <span className="text-[12px] text-muted">竞品周报 · 本群委派</span>
        <span className="ml-auto text-[11px] text-faint">{runs.length} 条</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-[820px] space-y-2">
          {runs.map((run) => (
            <article key={run.title} className="rounded-control border border-line">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
                <span className="font-medium">{run.from} → {run.to}</span>
                <span className="text-faint">· 委派</span>
                <span className="min-w-0 flex-1 truncate">{run.title}</span>
                <span className={tone[run.status]}>{run.status}</span>
                <span className="text-[11px] tabular-nums text-faint">{run.time}</span>
              </div>
              <div className="px-3 py-2">
                <pre className="mb-2 max-h-24 overflow-auto rounded-[4px] bg-code px-2 py-1 font-mono text-[11px] leading-5 text-muted">{run.logs.join('\n')}</pre>
                {run.need && <p className="mb-2 text-[11px] text-warning">卡住·缺：{run.need}</p>}
                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  {run.status === '卡住了' && <><button className="rounded-control bg-primary px-2.5 py-1 text-primary-foreground">回复</button><span className="text-faint">回复后接着做</span></>}
                  {run.status === '失败' && <><button className="rounded-control border border-border px-2.5 py-1">重试</button><button className="rounded-control border border-border px-2.5 py-1">改派</button></>}
                  {(run.status === '进行中' || run.status === '卡住了') && <button className="text-danger">取消</button>}
                  {run.status === '中断' && <><button className="rounded-control border border-border px-2.5 py-1">继续</button><button className="rounded-control border border-border px-2.5 py-1">重新开始</button></>}
                  <Link to="/bot-chat" className="ml-auto text-primary">打开子会话</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
