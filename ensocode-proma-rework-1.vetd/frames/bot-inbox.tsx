export const frame = { width: 1440, height: 900, title: "Bot · 待处理收件箱" };

import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../components/bot/BotShell';
import { inbox, members } from '../components/bot/data';

const kindIcon: Record<string, string> = { approval: 'icon-[lucide--shield-alert] text-warning', question: 'icon-[lucide--message-circle-question] text-primary', budget: 'icon-[lucide--wallet] text-danger', routine: 'icon-[lucide--alarm-clock] text-muted', memory: 'icon-[lucide--brain] text-muted' };

/** 收件箱：所有成员待你处理的事；审批 / 提问 / 预算 / 例程提案 / 记忆写入；处理后可「去聊天」 */
export default function BotInbox() {
  const [done, setDone] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const shown = inbox.filter((item) => !done.includes(item.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--inbox] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">收件箱</h1>
        <span className="text-[12px] text-muted">所有成员待你处理的事</span>
        <span className="ml-auto text-[11px] text-faint">{shown.length} 项待处理</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {!shown.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-muted"><span className="icon-[lucide--circle-check] size-6 text-success" />暂无待处理事项</div>
        ) : (
          <div className="mx-auto max-w-[760px] space-y-2">
            {shown.map((item) => {
              const person = members.find((member) => member.name === item.member);
              return (
                <article key={item.id} className="rounded-control border border-line">
                  <div className="flex items-start gap-2.5 px-3.5 py-3">
                    {person && <Avatar member={person} size="sm" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className={`${kindIcon[item.kind]} size-3.5 shrink-0`} />
                        <span className="font-medium">{item.title}</span>
                        <span className="text-[11px] text-faint">{item.member} · {item.time}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-muted">{item.detail}</p>
                      <p className="mt-1 text-[11px] text-faint">{item.need}</p>
                      {item.kind === 'approval' && (
                        <div className="mt-2 flex items-center gap-2 text-[12px]">
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control bg-primary px-2.5 py-1 text-primary-foreground">允许</button>
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control px-2.5 py-1 text-muted hover:bg-hover">本会话总是允许</button>
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control px-2.5 py-1 text-danger hover:bg-danger-soft">拒绝</button>
                          <span className="text-[11px] text-faint">隔离沙箱 · 一次性授权</span>
                        </div>
                      )}
                      {item.kind === 'question' && (
                        <div className="mt-2 flex items-center gap-2">
                          <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="回复 小满，回复后接着做…" aria-label="回复" className="h-7 min-w-0 flex-1 rounded-control border border-border bg-input px-2 text-[12px] outline-none" />
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control bg-primary px-2.5 py-1 text-[12px] text-primary-foreground">回复</button>
                        </div>
                      )}
                      {item.kind === 'routine' && (
                        <div className="mt-2 flex gap-2 text-[12px]">
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control bg-primary px-2.5 py-1 text-primary-foreground">批准</button>
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control px-2.5 py-1 text-danger hover:bg-danger-soft">拒绝</button>
                        </div>
                      )}
                      {item.kind === 'memory' && (
                        <div className="mt-2 flex gap-2 text-[12px]">
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control bg-primary px-2.5 py-1 text-primary-foreground">写入</button>
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control px-2.5 py-1 text-muted hover:bg-hover">忽略</button>
                        </div>
                      )}
                      {item.kind === 'budget' && (
                        <div className="mt-2 flex gap-2 text-[12px]">
                          <Link to="/settings-bots" className="rounded-control border border-border px-2.5 py-1 hover:bg-hover">调整预算</Link>
                          <button onClick={() => setDone([...done, item.id])} className="rounded-control px-2.5 py-1 text-muted hover:bg-hover">知道了</button>
                        </div>
                      )}
                    </div>
                    <Link to="/bot-chat" className="shrink-0 text-[11px] text-primary">去聊天</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
