import { useState } from 'react';
import { Link } from 'react-router';
import { MenuItem, MenuPanel, Spinner, useDismiss } from '../Controls';
import { groups, groupTimeline, members, type Member } from './data';
import { Avatar } from './BotShell';

const time = '11:42';

function Head({ member, group }: { member?: Member; group?: string }) {
  const [history, setHistory] = useState(false);
  const ref = useDismiss<HTMLDivElement>(history, () => setHistory(false));
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
      {member ? <Avatar member={member} /> : <span className="flex size-8 items-center justify-center rounded-full bg-control text-muted"><span className="icon-[lucide--users] size-4" /></span>}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          {member?.name ?? group}
          {member?.title && <span className="rounded-[4px] bg-control px-1 text-[11px] font-normal text-muted">{member.title}</span>}
          {member?.status.includes('工作中') && <span className="flex items-center gap-1 text-[11px] font-normal text-primary"><Spinner className="size-3" />工作中</span>}
          {member?.status.includes('排队') && <span className="text-[11px] font-normal text-warning">排队</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">{member ? member.model : '4 名成员 · 群主 阿岚'}</span>
          {member && <><span className="text-border">·</span><span className="truncate">{member.budget}</span></>}
        </div>
      </div>
      <div ref={ref} className="relative ml-auto flex items-center gap-1">
        <button onClick={() => setHistory(!history)} className="flex h-7 items-center gap-1.5 rounded-control border border-border px-2 text-[11px] text-muted hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--history] size-3.5" />历史</button>
        {history && (
          <MenuPanel label="会话历史" className="right-0 top-8 w-72">
            <div className="px-2 py-1.5 text-[11px] text-faint">成员会话 · 切换后进入该次对话</div>
            {[{ title: '竞品周报 · 第 43 周', time: '进行中', active: true }, { title: '竞品周报 · 第 42 周', time: '上周五' }, { title: '渠道对比口径', time: '10 月 21 日' }].map((item) => (
              <MenuItem key={item.title} label={item.title} trailing={<span className="shrink-0 text-[11px] text-faint">{item.time}</span>} checked={item.active} onClick={() => setHistory(false)} />
            ))}
          </MenuPanel>
        )}
        <button className="flex h-7 items-center gap-1.5 rounded-control border border-border px-2 text-[11px] text-muted hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--plus] size-3.5" />新对话</button>
        <button className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--panel-right] size-4" /></button>
        <button className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--ellipsis] size-4" /></button>
      </div>
    </header>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="mb-4 flex flex-col items-end">
      <div className="max-w-[78%] rounded-control bg-panel px-3.5 py-2 text-[13.5px] leading-6">{text}</div>
      <span className="mt-1 text-[11px] text-faint">你 · {time}</span>
    </div>
  );
}

function MemberBubble({ member, text, working }: { member: string; text: string; working?: boolean }) {
  const person = members.find((item) => item.name === member);
  return (
    <div className="mb-4 flex gap-2.5">
      {person && <Avatar member={person} size="sm" />}
      <div className="min-w-0 max-w-[80%]">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">{member}<span className="text-border">·</span>{time}{working && <span className="flex items-center gap-1 text-primary"><Spinner className="size-2.5" />回复中</span>}</div>
        <div className="rounded-control bg-control/45 px-3.5 py-2 text-[13.5px] leading-6">{text}</div>
      </div>
    </div>
  );
}

function TaskEvent({ id, title, to, status }: { id: string; title: string; to: string; status: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-control border border-line px-3 py-2 text-[12px]">
      <span className="icon-[lucide--square-kanban] size-3.5 text-muted" />
      <span className="text-faint">任务 {id}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      <span className="text-muted">→ {to}</span>
      <span className="rounded-[4px] bg-primary-soft px-1.5 text-primary">{status}</span>
      <Link to="/bot-board" className="text-[11px] text-primary">打开看板</Link>
    </div>
  );
}

function DelegationEvent({ from, to, title, status, need }: { from: string; to: string; title: string; status: string; need?: string }) {
  return (
    <div className="mb-3 rounded-control border border-line bg-panel/40 px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="icon-[lucide--git-branch] size-3.5 text-muted" />
        <span className="font-medium">{from} → {to}</span>
        <span className="text-faint">· 委派</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className={status === '卡住了' ? 'text-warning' : status === '失败' ? 'text-danger' : 'text-muted'}>{status}</span>
        <Link to="/bot-delegation" className="text-[11px] text-primary">查看过程</Link>
      </div>
      {need && <p className="mt-1 text-[11px] text-warning">卡住·缺：{need}</p>}
    </div>
  );
}

function RoutineEvent({ title, member, result }: { title: string; member: string; result: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] text-faint">
      <span className="h-px flex-1 bg-line" />
      <span className="icon-[lucide--alarm-clock] size-3" />
      例程「{title}」· 由 {member} 执行 · {result}
      <Link to="/bot-routines" className="text-primary">例行</Link>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Bot 输入框（bots/BotComposer.tsx）：@ 成员、所有人、技能、图片、停止/发送；群聊提示智能选人 */
function BotComposer({ running, queued }: { running?: boolean; queued?: number }) {
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState('所有人');
  return (
    <div className="shrink-0 pb-3">
      {queued ? <div className="mb-1.5 flex items-center gap-2 rounded-control border border-border/70 bg-panel/45 px-3 py-1 text-[11.5px]"><span className="text-faint">排队</span><span className="min-w-0 flex-1 truncate">顺便把口径那条也写进周报里</span><span className="flex items-center gap-1 text-muted"><span className="icon-[lucide--images] size-3" />1</span><span className="flex items-center gap-0.5 text-muted"><span className="icon-[lucide--pencil] size-3" /><span className="icon-[lucide--send] size-3" /><span className="icon-[lucide--x] size-3" /></span></div> : null}
      <div className="rounded-control border border-border bg-input focus-within:border-primary/60">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder={running ? '阿岚正在工作，新消息会插入当前这一轮' : '不 @ 时智能选出最合适的成员回复'} aria-label="Bot 输入" className="block h-[52px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13.5px] leading-6 outline-none placeholder:text-faint" />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button className="flex h-7 items-center gap-1 rounded-control px-1.5 text-[12px] text-muted hover:bg-hover"><span className="icon-[lucide--at-sign] size-3.5" />{target}</button>
          <button title="添加图片" className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--image-plus] size-3.5" /></button>
          <button title="技能" className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--sparkles] size-3.5" /></button>
          <span className="ml-1 text-[11px] text-faint">{running ? '排队中，等有空闲会话名额后开始，或按 Enter 插入本轮' : '群聊 / 私聊'}</span>
          <div className="flex-1" />
          {running ? (
            <button className="flex size-8 items-center justify-center rounded-[10px] bg-surface-foreground text-surface"><span className="icon-[lucide--circle-stop] size-4" /></button>
          ) : (
            <button disabled={!draft.trim()} className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground disabled:opacity-35"><span className="icon-[lucide--arrow-up] size-4" /></button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-faint">
        <span>{running ? '阿岚工作中 · 新消息插入当前这一轮' : '不 @ 时由群主回复'}</span>
        <span className="ml-auto">4 名成员 · 群主 阿岚</span>
      </div>
    </div>
  );
}

/** 右侧资料面板（BotProfilePanel / GroupInfoPanel / BotBrowserPanel） */
export function BotPanel({ kind, member }: { kind: 'profile' | 'group' | 'browser'; member?: Member }) {
  const tabs = [{ id: 'profile', label: '资料' }, { id: 'ability', label: '能力' }, { id: 'memory', label: '记忆' }, { id: 'routine', label: '例行' }, { id: 'history', label: '历史' }];
  const [tab, setTab] = useState('profile');
  const [mode, setMode] = useState<'direct' | 'group' | 'browser'>(kind);
  return (
    <aside aria-label="Bot 资料面板" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-1">
        {([['direct', '资料'], ['group', '群信息'], ['browser', '浏览器']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} className={`h-7 rounded-control px-2.5 text-[12px] ${mode === id ? 'bg-control font-medium text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>{label}</button>
        ))}
        <button className="ml-auto flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--x] size-3.5" /></button>
      </div>
      {mode === 'browser' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 items-center gap-1 border-b border-line px-2 text-[11px]">
            <span className="icon-[lucide--globe] size-3.5 text-muted" />
            <span className="min-w-0 flex-1 truncate rounded-full bg-input px-2 py-0.5 font-mono">competitors.example.com</span>
            <span className="flex items-center gap-1 text-warning"><Spinner className="size-3" />占用中</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-panel/40 p-3 text-[12px] leading-6">
            <p className="text-faint">成员浏览器 · 小满</p>
            <p className="mt-1">已打开 3 个标签，当前抓取公开页面的功能对比表。</p>
            <div className="mt-2 rounded-control border border-line bg-surface p-2 font-mono text-[11px]">
              <p>browser.open competitors.example.com/a</p>
              <p>browser.snapshot → 42 nodes</p>
              <p className="text-primary">browser.click ref=18「多成员协作」</p>
            </div>
          </div>
          <div className="flex h-9 items-center gap-2 border-t border-line px-2 text-[11px]"><button className="rounded-control border border-border px-2 py-0.5">我来接管</button><span className="text-faint">接管后成员暂停操作</span></div>
        </div>
      ) : mode === 'group' ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[12px]">
          <p className="text-[13px] font-medium">竞品周报</p>
          <p className="mt-1 text-muted">群主 阿岚 · 4 名成员 · 接力上限 2 次</p>
          <dl className="mt-3 grid grid-cols-[64px_1fr] gap-y-2">
            <dt className="text-muted">共享工作区</dt><dd className="font-mono text-[11.5px]">~/githubproject/reports</dd>
            <dt className="text-muted">选人方式</dt><dd>智能选人（群聊选人模型）</dd>
            <dt className="text-muted">话题</dt><dd>3 个 · 当前「第 43 周」</dd>
            <dt className="text-muted">并发</dt><dd>1 / 3 个会话运行中</dd>
          </dl>
          <p className="mt-3 border-t border-line pt-2 text-[11px] leading-5 text-muted">群内成员共享这个目录，能和任一成员对话的人，都能经由他触达目录里的内容。</p>
          <div className="mt-2 flex gap-2"><button className="rounded-control border border-border px-2 py-1 text-[11px]">编辑群信息</button><button className="rounded-control border border-border px-2 py-1 text-[11px]">新建话题</button></div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-1">
            {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`h-8 rounded-control px-2 text-[12px] ${tab === item.id ? 'font-medium text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>{item.label}</button>)}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[12px]">
            {tab === 'profile' && (
              <>
                <div className="flex items-center gap-2">
                  {member && <Avatar member={member} size="lg" />}
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{member?.name ?? '阿岚'} <span className="rounded-[4px] bg-primary-soft px-1 text-[10px] text-primary">群主</span></p>
                    <p className="text-[11px] text-muted">{member?.title} · 群内 @ 用，必须唯一</p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-[56px_1fr] gap-y-2">
                  <dt className="text-muted">职责</dt><dd>{member?.duty}</dd>
                  <dt className="text-muted">模型</dt><dd>{member?.model}</dd>
                  <dt className="text-muted">人设</dt><dd className="leading-5">用数据说话，先给结论再补依据；不确定的口径先问。</dd>
                  <dt className="text-muted">头像颜色</dt><dd><span className="flex gap-1">{[...Array(6)].map((_, index) => <span key={index} className={`size-4 rounded-full ${index === 0 ? 'bg-primary' : index === 1 ? 'bg-warning' : index === 2 ? 'bg-success' : index === 3 ? 'bg-danger' : index === 4 ? 'bg-muted' : 'bg-surface-foreground'}`} />)}</span></dd>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2 text-[11px]">
                  <button className="rounded-control border border-border px-2 py-1">导出人物卡</button>
                  <button className="rounded-control border border-border px-2 py-1">归档成员</button>
                  <button className="rounded-control px-2 py-1 text-danger">永久删除</button>
                </div>
              </>
            )}
            {tab === 'ability' && (
              <div className="space-y-2">
                {[['工具', '全部工具（bash / edit / write / browser）'], ['审批档位', '自动接受编辑'], ['技能', '竞品检索 · 表格整理'], ['MCP', 'browser-tools（常驻）'], ['委派关系', '可委派给 小满、老周；接受来自 阿岚'], ['日预算', member?.budget ?? '今日 $1.20 / $3.00'], ['单回合 Token 上限', '60K'], ['委派时限', '30 分钟']].map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-2 border-b border-line pb-1.5">
                    <span className="w-[92px] shrink-0 text-muted">{label}</span>
                    <span className="min-w-0 flex-1">{value}</span>
                  </div>
                ))}
                <p className="text-[11px] leading-5 text-muted">调低上限不会打断进行中的回复；调高可能触发模型限流。</p>
              </div>
            )}
            {tab === 'memory' && (
              <>
                <p className="text-muted">核心笔记</p>
                <div className="mt-1 rounded-control border border-line px-2 py-1.5 leading-5">周报口径以自然周为准；渠道数据以老周的 CSV 为唯一来源。</div>
                <div className="mt-2 flex items-center justify-between"><p className="text-muted">记忆空间</p><span className="text-[11px] text-faint">{member?.memory ?? 42} 条</span></div>
                {['竞品事实', '写作偏好', '历史结论'].map((space) => (
                  <button key={space} className="mt-1 flex w-full items-center gap-2 rounded-control border border-line px-2 py-1.5 text-left hover:bg-hover">
                    <span className="icon-[lucide--folder] size-3.5 text-muted" />
                    <span className="flex-1">{space}</span>
                    <span className="icon-[lucide--chevron-right] size-3 text-faint" />
                  </button>
                ))}
                <p className="mt-2 text-[11px] text-muted">写入记忆需要你审批，可在收件箱处理。</p>
              </>
            )}
            {tab === 'routine' && (
              <div className="space-y-1.5">
                {[['每日竞品快照', '工作日 09:00 · 下次明天 09:00'], ['周报提醒', '每周五 16:00 · 下次周五']].map(([title, meta]) => (
                  <div key={title} className="rounded-control border border-line px-2 py-1.5">
                    <p className="font-medium">{title}</p>
                    <p className="text-[11px] text-muted">{meta}</p>
                  </div>
                ))}
                <Link to="/bot-routines" className="block text-[11px] text-primary">打开例行任务列表</Link>
              </div>
            )}
            {tab === 'history' && (
              <div className="space-y-1">
                {['竞品周报 · 第 43 周（当前）', '竞品周报 · 第 42 周', '渠道对比口径', '发布检查 · 9 月'].map((title, index) => (
                  <div key={title} className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-hover">
                    <span className={`size-1.5 rounded-full ${index === 0 ? 'bg-success' : 'bg-border'}`} />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    <span className="text-[11px] text-faint">{index === 0 ? '当前' : '只读'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** 群聊 / 私聊主体（bots/BotChatView.tsx）：时间线 + 输入框 + 可选右侧资料面板 */
export function BotChat({ mode, panel }: { mode: 'dm' | 'group'; panel?: boolean }) {
  const member = members[0];
  const group = groups[0];
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <Head member={mode === 'dm' ? member : undefined} group={mode === 'group' ? group.name : undefined} />
        {mode === 'group' && (
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-3 text-[11px]">
            {group.threads.map((thread) => (
              <span key={thread.id} className={`flex h-6 items-center gap-1 rounded-control px-2 ${thread.active ? 'bg-selected text-surface-foreground' : 'text-muted'}`}><span className="icon-[lucide--hash] size-3" />{thread.name}{thread.unread ? <span className="ml-1 size-1.5 rounded-full bg-primary" /> : null}</span>
            ))}
            <button className="flex h-6 items-center gap-1 rounded-control px-2 text-faint hover:text-surface-foreground"><span className="icon-[lucide--plus] size-3" />新建话题</button>
            <span className="ml-auto text-faint">群聊 · 一次只有一位成员回复</span>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-[720px]">
            {mode === 'dm' ? (
              <>
                <div className="mb-4 flex items-center gap-1.5 text-[11px] text-faint"><span className="icon-[lucide--info] size-3" />和 {member.name} 打个招呼 · 私聊不会进群聊话题</div>
                <UserBubble text="这周竞品周报，你先起个草，重点写多成员协作。" />
                <MemberBubble member={member.name} text="先确认一下：三家都写，还是只写动作最大的两家？我先按三家起稿，口径不对你直接改。" working />
                <MemberBubble member={member.name} text="草稿在共享工作区 reports/43w-draft.md，结构是「动作 → 我们对比 → 建议」。数据等老周的 CSV 出来再补。" />
                <div className="mb-3 flex items-center gap-2 text-[11px] text-faint"><span className="h-px flex-1 bg-line" />阿岚 已转交给 老周 · 数据补充<span className="h-px flex-1 bg-line" /></div>
                <div className="rounded-control border border-line bg-panel/40 px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-2"><span className="icon-[lucide--git-branch] size-3.5 text-muted" /><span className="font-medium">阿岚 → 老周</span><span className="text-faint">· 委派</span><span className="min-w-0 flex-1 truncate">补充 43 周环比指标</span><span className="text-success">已完成</span><Link to="/bot-delegation" className="text-[11px] text-primary">查看过程</Link></div>
                  <p className="mt-1 text-[11px] text-muted">验收通过：metrics/43w.csv 与看板一致。</p>
                </div>
              </>
            ) : (
              <>
                {groupTimeline.map((event, index) => {
                  if (event.kind === 'user') return <UserBubble key={index} text={event.text} />;
                  if (event.kind === 'member') return <MemberBubble key={index} member={event.member} text={event.text} working={event.working} />;
                  if (event.kind === 'task') return <TaskEvent key={index} {...event} />;
                  if (event.kind === 'delegation') return <DelegationEvent key={index} {...event} />;
                  return <RoutineEvent key={index} {...event} />;
                })}
                <div className="mt-4 flex items-center gap-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-5">
                  <span className="icon-[lucide--message-circle-question] size-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">小满 需要你处理：要不要把上一代产品也算进来？</span>
                  <Link to="/bot-inbox" className="shrink-0 text-primary">去收件箱</Link>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mx-4">
          <div className="mx-auto max-w-[720px]"><BotComposer running={mode === 'group'} queued={mode === 'group' ? 1 : 0} /></div>
        </div>
      </div>
      {panel && <BotPanel kind={mode === 'dm' ? 'profile' : 'group'} member={mode === 'dm' ? member : undefined} />}
    </div>
  );
}
