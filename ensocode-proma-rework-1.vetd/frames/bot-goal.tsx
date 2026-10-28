export const frame = { width: 1440, height: 900, title: "Bot · 从目标开始" };

import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../components/bot/BotShell';
import { members, personas, templates } from '../components/bot/data';

/** 从目标开始（bots/GoalOnboarding.tsx）：目标 → 推荐成员或团队 → 第一条消息（放进输入框，不会自动发送） */
export default function BotGoal() {
  const [step, setStep] = useState<0 | 1 | 2>(1);
  const [goal, setGoal] = useState('每周跟踪三家竞品的动态，出一份可以发的周报');
  const [first, setFirst] = useState('先看这周三家在多成员协作上的更新，按「动作 → 我们对比 → 建议」起稿。');
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--compass] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">从目标开始</h1>
        <div className="ml-auto flex items-center gap-1.5 text-[11px]">
          {['目标', '推荐', '第一条消息'].map((label, index) => (
            <span key={label} className={`flex items-center gap-1 ${index === step ? 'text-surface-foreground' : 'text-faint'}`}>
              <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${index <= step ? 'bg-primary text-primary-foreground' : 'bg-control'}`}>{index + 1}</span>
              {label}
              {index < 2 && <span className="icon-[lucide--chevron-right] size-3 text-border" />}
            </span>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[720px]">
          {step === 0 && (
            <>
              <label className="text-[13px] font-medium">你想完成什么</label>
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} placeholder="例如：每周跟踪竞品动态，给我发一份摘要" className="mt-2 block w-full resize-none rounded-control border border-border bg-input p-3 text-[14px] leading-6 outline-none focus:border-primary/60" />
              <p className="mt-1.5 text-[11px] text-muted">描述结果即可，成员与团队由 Agent 推荐；之后可以改。</p>
              <div className="mt-4 flex justify-end gap-2">
                <Link to="/bot" className="px-3 py-1.5 text-[12px] text-muted">取消</Link>
                <button onClick={() => setStep(1)} disabled={!goal.trim()} className="rounded-control bg-surface-foreground px-4 py-1.5 text-[12px] text-surface disabled:opacity-50">继续</button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-[13px] text-muted">目标：{goal}</p>
              <div className="mt-3 space-y-2">
                <div className="rounded-control border border-primary/40 bg-primary-soft/30 p-3">
                  <div className="flex items-center gap-2">
                    <span className="icon-[lucide--users] size-4 text-primary" />
                    <span className="text-[13px] font-medium">推荐：一个团队</span>
                    <span className="rounded-[4px] bg-primary px-1.5 text-[10px] text-primary-foreground">推荐</span>
                    <span className="ml-auto text-[11px] text-muted">{templates[0].members} 名成员 · 共享工作区</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{templates[0].desc}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {members.slice(0, 3).map((member) => (
                      <span key={member.id} className="flex items-center gap-1.5 text-[12px]"><Avatar member={member} size="sm" />{member.name}<span className="text-[11px] text-faint">{member.title}</span></span>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-end gap-2"><button onClick={() => setStep(2)} className="rounded-control bg-surface-foreground px-3 py-1 text-[12px] text-surface">创建这个团队</button></div>
                </div>
                <div className="rounded-control border border-line p-3">
                  <div className="flex items-center gap-2">
                    <span className="icon-[lucide--user] size-4 text-muted" />
                    <span className="text-[13px] font-medium">推荐：单个成员</span>
                    <span className="ml-auto text-[11px] text-muted">{members[0].title} · {members[0].model}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">由一位成员独立完成，适合节奏快、口径固定的周报。</p>
                  <div className="mt-2 flex items-center gap-2"><Avatar member={members[0]} size="sm" /><span className="text-[12px]">{members[0].name}</span><span className="text-[11px] text-faint">{personas[0]}</span><div className="ml-auto flex gap-2"><button onClick={() => setStep(2)} className="rounded-control border border-border px-3 py-1 text-[12px] hover:bg-hover">用这个成员</button><button className="px-2 py-1 text-[12px] text-muted">还是新建</button></div></div>
                </div>
              </div>
              <div className="mt-4 flex justify-between">
                <button onClick={() => setStep(0)} className="px-2 py-1.5 text-[12px] text-muted">上一步</button>
                <span className="text-[11px] text-faint">创建后可随时添加或解雇成员</span>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-[13px]">第一条消息<span className="ml-2 text-[11px] text-muted">放进输入框，不会自动发送</span></p>
              <textarea value={first} onChange={(event) => setFirst(event.target.value)} rows={4} className="mt-2 block w-full resize-none rounded-control border border-border bg-input p-3 text-[13.5px] leading-6 outline-none focus:border-primary/60" />
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-[4px] bg-primary-soft px-1.5 py-0.5 text-primary">@阿岚</span>
                <span className="rounded-[4px] bg-control px-1.5 py-0.5 text-muted">群聊 · 竞品周报</span>
                <span className="rounded-[4px] bg-control px-1.5 py-0.5 text-muted">共享工作区 ~/githubproject/reports</span>
              </div>
              <div className="mt-4 flex justify-between">
                <button onClick={() => setStep(1)} className="px-2 py-1.5 text-[12px] text-muted">上一步</button>
                <Link to="/bot-group" className="rounded-control bg-surface-foreground px-4 py-1.5 text-[12px] text-surface">创建并开始私聊</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
