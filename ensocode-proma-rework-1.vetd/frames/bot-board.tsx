export const frame = { width: 1440, height: 900, title: "Bot · 群组任务看板" };

import { useState } from 'react';
import { Avatar } from '../components/bot/BotShell';
import { board, members } from '../components/bot/data';

const columns = ['待办', '进行中', '卡住', '待验收', '已完成', '已取消'] as const;
const columnTone: Record<string, string> = { 待办: 'text-muted', 进行中: 'text-primary', 卡住: 'text-warning', 待验收: 'text-primary', 已完成: 'text-success', 已取消: 'text-faint' };

/** 群组看板（bots/GroupBoard.tsx）：任务卡、指派/改派、验收通过/退回返工（原因必填）、评论 */
export default function BotBoard() {
  const [selected, setSelected] = useState('#12');
  const [reject, setReject] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const active = board.find((task) => task.id === selected);
  const person = (name: string) => members.find((member) => member.name === name);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--square-kanban] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">竞品周报 · 任务看板</h1>
        <span className="text-[12px] text-muted">4 名成员 · 群主 阿岚</span>
        <div className="ml-auto flex items-center gap-2">
          <button className="h-7 rounded-control border border-border px-2 text-[12px] hover:bg-hover">显示全部（{board.length}）</button>
          <button className="h-7 rounded-control bg-surface-foreground px-2.5 text-[12px] text-surface"><span className="icon-[lucide--plus] mr-1 inline size-3.5 align-[-2px]" />新建任务</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-x-auto px-4 py-3">
          <div className="grid min-w-[1000px] grid-cols-6 gap-2.5">
            {columns.map((column) => {
              const list = board.filter((task) => task.column === column && !done.includes(task.id));
              return (
                <section key={column} className="flex min-h-0 flex-col">
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px]">
                    <span className={`font-medium ${columnTone[column]}`}>{column}</span>
                    <span className="tabular-nums text-faint">{list.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {list.map((task) => (
                      <div key={task.id} role="button" tabIndex={0} onClick={() => setSelected(task.id)} className={`w-full cursor-pointer rounded-control border px-2.5 py-2 text-left ${selected === task.id ? 'border-primary/50 bg-primary-soft/40' : 'border-line bg-surface hover:bg-hover'}`}>
                        <div className="flex items-center gap-1 whitespace-nowrap text-[11px] text-faint"><span className="tabular-nums">{task.id}</span>{task.stuck && <span className="ml-auto text-warning">卡住</span>}</div>
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] font-medium leading-5">{task.title}</p>
                        <div className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
                          {task.assignee ? <><Avatar member={person(task.assignee) ?? { name: '未指派', color: 'bg-muted' }} size="sm" /><span>{task.assignee}</span></> : <span>未指派</span>}
                        </div>
                        {task.accept && <p className="mt-1 truncate text-[11px] text-faint" title={`验收条件：${task.accept}`}>验收条件：{task.accept}</p>}
                      </div>
                    ))}
                    {!list.length && <p className="rounded-control border border-dashed border-border px-2 py-4 text-center text-[11px] text-faint">空</p>}
                  </div>
                </section>
              );
            })}
          </div>
          <p className="mt-3 px-1 text-[11px] text-muted">成员也可以用看板工具新建和认领任务。</p>
        </div>
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-line">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
            <span className="font-medium">{active?.id}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{active?.title}</span>
            <button className="text-[11px] text-primary">编辑</button>
            <button className="text-[11px] text-muted">删除</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-[12px]">
            <dl className="grid grid-cols-[64px_1fr] gap-y-2">
              <dt className="text-muted">状态</dt><dd className={columnTone[active?.column ?? '待办']}>{active?.column}</dd>
              <dt className="text-muted">指派给</dt><dd>{active?.assignee || '未指派'} <button className="ml-1 text-[11px] text-primary">改派</button></dd>
              <dt className="text-muted">验收条件</dt><dd className="leading-5">{active?.accept || '未填写'}</dd>
              <dt className="text-muted">由谁创建</dt><dd>阿岚</dd>
            </dl>
            {active?.stuck && <p className="mt-2 rounded-control border border-warning/40 bg-warning-soft px-2 py-1.5 text-[11px] leading-5">卡住·缺：{active.stuck} · <button className="text-primary">回复 小满</button></p>}
            <div className="mt-3 border-t border-line pt-2">
              <p className="text-muted">评论</p>
              <div className="mt-1 space-y-1.5">
                <div className="rounded-control bg-panel px-2 py-1.5"><p className="text-[11px] text-faint">阿岚 · 09:48</p><p className="leading-5">先把三家的口径统一，再补数据。</p></div>
                <div className="rounded-control bg-panel px-2 py-1.5"><p className="text-[11px] text-faint">小满 · 10:02</p><p className="leading-5">口径已按自然周整理，等确认上一代是否算。</p></div>
              </div>
              <input placeholder="评论…" aria-label="评论" className="mt-1.5 h-7 w-full rounded-control border border-border bg-input px-2 text-[12px] outline-none" />
              <input placeholder="补充给当前执行…" aria-label="补充给当前执行" className="mt-1 h-7 w-full rounded-control border border-border bg-input px-2 text-[12px] outline-none" />
            </div>
            {reject ? (
              <div className="mt-3 rounded-control border border-danger/30 bg-danger-soft px-2 py-2">
                <p className="text-[11.5px] font-medium text-danger">退回返工 {reject}</p>
                <p className="mt-1 text-[11px] leading-5">小满 会带着退回原因在原会话里接着改，改完回到待验收。</p>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="退回原因（必填）" aria-label="退回原因" className="mt-1.5 h-14 w-full rounded-control border border-border bg-surface px-2 py-1 text-[12px] outline-none" />
                <div className="mt-1.5 flex justify-end gap-2">
                  <button onClick={() => setReject('')} className="px-2 py-1 text-[11px] text-muted">取消</button>
                  <button disabled={!reason.trim()} onClick={() => { setDone([...done, reject]); setReject(''); setReason(''); }} className="rounded-control bg-danger px-2.5 py-1 text-[11px] text-white disabled:opacity-50">退回返工</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3 text-[12px]">
            {active?.column === '待验收' ? (
              <>
                <button className="rounded-control bg-primary px-2.5 py-1 text-primary-foreground">验收通过</button>
                <button onClick={() => setReject(active?.id ?? '')} className="rounded-control px-2.5 py-1 text-danger hover:bg-danger-soft">退回返工</button>
              </>
            ) : active?.column === '已完成' ? (
              <span className="text-muted">任务已完成</span>
            ) : (
              <>
                <button className="rounded-control bg-surface-foreground px-2.5 py-1 text-surface">标记完成</button>
                <button className="rounded-control px-2.5 py-1 text-muted hover:bg-hover">取消任务</button>
              </>
            )}
            <button className="ml-auto text-[11px] text-muted hover:text-surface-foreground">删除任务</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
