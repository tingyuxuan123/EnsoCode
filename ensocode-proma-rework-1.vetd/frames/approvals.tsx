export const frame = { width: 1440, height: 900, title: "运行控制 · 审批、提问与计划" };

import { useState } from 'react';
import { Link } from 'react-router';
import { buttonClass, inputClass, StateBar } from '../components/Controls';

const tabs = ['工具审批', 'Agent 提问', '计划模式', '自主目标', '插话队列'];
const queueSeed = ['补充检查小窗口下的输入区域。', '请保留现有快捷键，不修改运行逻辑。'];
export default function ApprovalsScreen() {
  const [tab, setTab] = useState(tabs[0]);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('命令');
  const [protectedAction, setProtectedAction] = useState(false);
  const [requestState, setRequestState] = useState('等待确认');
  const [approvalResult, setApprovalResult] = useState('');
  const [answer, setAnswer] = useState('');
  const [answered, setAnswered] = useState('');
  const [revise, setRevise] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [planState, setPlanState] = useState('待审批');
  const [planExpanded, setPlanExpanded] = useState(true);
  const [mode, setMode] = useState('自动接受编辑');
  const [goal, setGoal] = useState('统一工作台的布局并完成界面验收');
  const [goalStatus, setGoalStatus] = useState('进行中');
  const [queue, setQueue] = useState(queueSeed);
  const [editing, setEditing] = useState(-1);
  const [draft, setDraft] = useState('');
  const respond = (result: string) => { setApprovalResult(result); setStatus(`${result}。此处仅记录预览决定，不执行工具。`); };
  const command = kind === '命令' ? 'pnpm typecheck && pnpm lint && pnpm test' : kind === '文件编辑' ? 'src/renderer/components/chat/Sidebar.tsx\n调整项目导航和会话列表的结构与样式' : kind === '文件写入' ? 'docs/ui-review.md\n写入界面验收说明' : 'workspace-tools / list_files\n{ "projectId": "EnsoCode" }';
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-7 py-5">
        <div><h1 className="text-[22px] font-semibold">运行控制</h1><p className="mt-1.5 text-[12px] text-muted">把需要你决定的操作放在同一条工作流里。</p></div>
        <Link to="/" className="ml-auto flex items-center gap-1.5 rounded-control border border-border px-3 py-2 text-[12px]"><span className="icon-[lucide--arrow-left] size-3.5" />返回会话</Link>
      </header>
      <nav className="flex h-[45px] shrink-0 items-center gap-6 border-b border-line px-7" aria-label="运行控制场景">
        {tabs.map((item) => (
          <button key={item} onClick={() => { setTab(item); setStatus(''); }} className={`relative h-full whitespace-nowrap text-[12px] ${tab === item ? 'font-medium after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-primary' : 'text-muted'}`}>{item}</button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto px-7 py-6">
        <div className="mx-auto max-w-[900px]">
          <StateBar text={status} onClear={() => setStatus('')} />
          <div className="mb-5 flex items-center gap-2 text-[12px] text-muted"><span className="icon-[lucide--circle-dashed] size-4" />EnsoCode<span className="ml-auto text-[11px]">当前会话 · 设计示例</span></div>
          {tab === '工具审批' && (
            <>
              <p className="mb-6 text-[14px] leading-7">界面调整已完成。在结束前，需要执行项目的类型、代码规范和测试检查。</p>
              <section className="rounded-control border border-border">
                <header className="flex h-11 items-center gap-2 border-b border-line bg-panel/60 px-4"><span className="icon-[lucide--shield-alert] size-4 text-warning" /><h2 className="text-[14px] font-medium">{approvalResult || (requestState === '助手审查' ? '审批助手正在审查' : requestState === '已超时' ? '请求已超时' : '需要你的授权')}</h2><span className="ml-auto text-[11px] text-muted">1 / 2 请求</span></header>
                <div className="p-4">
                  <div className="mb-3 flex items-center gap-2 text-[12px]"><span className="icon-[lucide--terminal] size-3.5 text-muted" /><span>{kind}</span>{protectedAction && <span className="text-danger">· 受保护操作，仅单次授权</span>}<span className="ml-auto text-[11px] text-muted">{requestState === '已超时' ? '已过期 · 默认拒绝' : '有效期以真实请求为准'}</span></div>
                  <pre className="overflow-auto rounded-control bg-code px-3 py-3 text-[12px] leading-6 whitespace-pre-wrap">{command}</pre>
                  <p className="mt-3 text-[12px] leading-6 text-muted">{protectedAction ? '此操作不能通过“本会话始终允许”绕过授权。拒绝不会中止整个会话，Agent 会收到本次决定。' : '仅授权当前工具请求。普通请求可选择本会话内记住决定，受保护操作不允许永久授权。'}</p>
                  {!approvalResult && requestState === '等待确认' && <div className="mt-5 flex justify-end gap-3"><button onClick={() => respond('已拒绝本次操作')} className="px-3 py-2 text-[12px] text-danger">拒绝</button>{!protectedAction && <button onClick={() => respond('本会话已允许此类请求')} className="rounded-control border border-border px-3 py-2 text-[12px] text-muted">本会话始终允许</button>}<button onClick={() => respond('已允许本次操作')} className={buttonClass}>允许一次</button></div>}
                  {approvalResult && <button onClick={() => { setApprovalResult(''); setStatus(''); }} className="mt-4 text-[12px] text-primary">查看下一条示例请求 →</button>}
                  {requestState === '助手审查' && <p className="mt-4 flex items-center gap-2 text-[12px] text-muted"><span className="icon-[lucide--scan-line] size-4" />决定前不能重复提交；可继续查看上下文。</p>}
                </div>
              </section>
              <section className="mt-7 grid grid-cols-[170px_1fr] gap-5 border-t border-line pt-5">
                <div><h3 className="text-[13px] font-medium">状态预览</h3><p className="mt-2 text-[11px] leading-5 text-muted">切换真实存在的审批分支，检查不同安全边界。</p></div>
                <div>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="text-[12px] text-muted">工具类型
                      <select aria-label="审批工具类型" value={kind} onChange={(event) => { setKind(event.target.value); setApprovalResult(''); }} className={`${inputClass} mt-2`}>
                        <option>命令</option><option>文件编辑</option><option>文件写入</option><option>MCP 工具</option>
                      </select>
                    </label>
                    <label className="text-[12px] text-muted">请求状态
                      <select aria-label="审批请求状态" value={requestState} onChange={(event) => { setRequestState(event.target.value); setApprovalResult(''); }} className={`${inputClass} mt-2`}>
                        <option>等待确认</option><option>助手审查</option><option>已超时</option>
                      </select>
                    </label>
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-[12px] text-muted">
                    <input type="checkbox" checked={protectedAction} onChange={(event) => { setProtectedAction(event.target.checked); setApprovalResult(''); }} />
                    受保护操作，禁止会话级授权
                  </label>
                </div>
              </section>
            </>
          )}
          {tab === 'Agent 提问' && (
            <>
              <p className="mb-6 text-[14px] leading-7">接下来需要确认工作树策略。Agent 会在收到答案后继续，不会自行猜测。</p>
              <section className="rounded-control border border-border p-5">
                <div className="mb-3 flex items-center gap-2"><span className="icon-[lucide--message-circle-question] size-4 text-primary" /><h2 className="text-[14px] font-medium">这次改动使用哪个工作区？</h2><span className="ml-auto text-[11px] text-muted">1 个问题</span></div>
                {answered ? (
                  <div className="rounded-control bg-panel p-4 text-[13px]">
                    <span className="text-muted">你的回答：</span>
                    {answered}
                    <button onClick={() => setAnswered('')} className="ml-4 text-[12px] text-primary">重新预览</button>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {['当前工作树', '新建隔离工作树', '先检查未提交改动'].map((option) => (
                        <button key={option} onClick={() => setAnswered(option)} className="rounded-control border border-border px-3 py-2 text-[12px] hover:bg-hover">{option}</button>
                      ))}
                    </div>
                    <label className="mb-2 block text-[12px] text-muted" htmlFor="free-answer">或输入你的安排</label>
                    <div className="flex gap-2">
                      <input id="free-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && answer.trim()) setAnswered(answer); }} placeholder="例如：先检查 main，保持现有文件不变…" className={inputClass} />
                      <button disabled={!answer.trim()} onClick={() => setAnswered(answer)} className={buttonClass}>回答</button>
                    </div>
                  </>
                )}
              </section>
              <p className="mt-4 text-[11px] leading-6 text-muted">提交中和过期状态会禁用选择与输入；设计稿不向真实 Agent 发送答案。</p>
            </>
          )}
          {tab === '计划模式' && (
            <>
              <div className="mb-4 flex items-center gap-2 text-[12px] text-muted"><span className="icon-[lucide--clipboard-list] size-4" />先只读调研，再确认计划。<span className="ml-auto">{planState}</span></div>
              <section className="rounded-control border border-border">
                <button className="flex h-12 w-full items-center gap-2 px-4 text-left" aria-expanded={planExpanded} onClick={() => setPlanExpanded(!planExpanded)}><span className={`${planExpanded ? 'icon-[lucide--chevron-down]' : 'icon-[lucide--chevron-right]'} size-3.5 text-muted`} /><h2 className="text-[14px] font-medium">统一工作台 UI 的实施计划</h2></button>
                {planExpanded && <div className="border-t border-line px-5 py-4 text-[13px] leading-7"><h3 className="mb-2 font-medium">范围</h3><p className="text-muted">只调整 renderer 布局和语义样式，不修改主进程与会话存储。</p><h3 className="mb-2 mt-4 font-medium">实施步骤</h3><ol className="list-decimal space-y-1 pl-5 text-muted"><li>梳理功能与共享外壳，保留全部功能入口。</li><li>统一项目导航、消息区域、输入区和工作区面板。</li><li>逐项检查弹窗、审批、计划和后台任务状态。</li><li>执行类型、测试与真实界面检查。</li></ol><h3 className="mb-2 mt-4 font-medium">验收</h3><p className="text-muted">原有功能可访问、交互路径完整、无裁切与底部遮挡。</p></div>}
                {revise && <div className="border-t border-line px-4 py-3"><label htmlFor="plan-feedback" className="mb-2 block text-[12px] text-muted">修改意见</label><textarea id="plan-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="说明需要调整的范围或步骤…" className="h-20 w-full rounded-control border border-border bg-input p-3 text-[13px] outline-none" /></div>}
                <footer className="flex flex-wrap items-center gap-3 border-t border-line p-4">
                  {planState === '待审批' ? (
                    <>
                      <button onClick={() => { setPlanState('已退出计划模式'); setStatus('演示计划已丢弃，未改变真实会话。'); }} className="text-[12px] text-danger">丢弃计划</button>
                      <button className="ml-auto text-[12px] text-muted" onClick={() => setRevise(!revise)}>修改意见</button>
                      {revise ? (
                        <button disabled={!feedback.trim()} onClick={() => { setPlanState('等待修订'); setStatus('修改意见已记录到预览。'); }} className={buttonClass}>提交意见</button>
                      ) : (
                        <>
                          <select aria-label="批准后的审批模式" value={mode} onChange={(event) => setMode(event.target.value)} className="rounded-control border border-border bg-input px-2 py-2 text-[12px]">
                            <option>自动接受编辑</option><option>全程审批</option><option>完全放行</option>
                          </select>
                          <button className={buttonClass} onClick={() => setPlanState('执行中')}>批准并执行</button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-[12px] text-muted">{planState === '执行中' ? `按“${mode}”推进，计划保留在会话中。` : planState}</span>
                      <button className="ml-auto text-[12px] text-primary" onClick={() => { setPlanState('待审批'); setRevise(false); }}>重置预览</button>
                      {planState === '执行中' && <button className={buttonClass} onClick={() => setPlanState('执行已结束')}>结束计划模式</button>}
                    </>
                  )}
                </footer>
              </section>
            </>
          )}
          {tab === '自主目标' && (
            <section>
              <h2 className="mb-3 text-[16px] font-medium">会话目标</h2>
              <p className="mb-5 text-[13px] leading-6 text-muted">目标固定在会话中，Agent 可自动推进；暂停不会删除已完成的结果。</p>
              <label className="mb-2 block text-[12px] text-muted" htmlFor="session-goal">要达成的结果</label><input id="session-goal" className={inputClass} value={goal} onChange={(event) => setGoal(event.target.value)} />
              <div className="mt-5 flex items-center gap-3 rounded-control border border-border p-4"><span className="icon-[lucide--target] size-4 text-muted" /><span className="min-w-0 flex-1 text-[13px]">{goal || '尚未设置目标'}</span><span className="whitespace-nowrap text-[12px] text-muted">{goalStatus} {goalStatus === '进行中' ? '· 4/25 轮' : ''}</span></div>
              <div className="mt-4 flex gap-3">
                <button disabled={!goal.trim()} className={buttonClass} onClick={() => setGoalStatus(goalStatus === '进行中' ? '已暂停' : '进行中')}>{goalStatus === '进行中' ? '暂停目标' : '继续推进'}</button>
                <button onClick={() => { setGoal(''); setGoalStatus('已清除'); }} className="px-3 py-2 text-[12px] text-danger">清除目标</button>
                <select aria-label="目标状态预览" value={goalStatus} onChange={(event) => setGoalStatus(event.target.value)} className="ml-auto rounded-control border border-border bg-input px-2 text-[12px]">
                  <option>进行中</option><option>已暂停</option><option>等待中</option><option>已阻塞</option><option>已完成</option><option>已清除</option>
                </select>
              </div>
              {goalStatus === '已阻塞' && <p className="mt-4 text-[12px] text-danger">需要补充工作区信息。给出新线索后可继续推进。</p>}
            </section>
          )}
          {tab === '插话队列' && (
            <section>
              <div className="mb-5 flex items-center gap-2"><h2 className="text-[16px] font-medium">待发送消息</h2><span className="text-[12px] text-muted">{queue.length} 条</span><button className="ml-auto text-[12px] text-primary" onClick={() => setQueue([...queue, '新增一条任务补充。'])}>添加示例补充</button></div>
              {queue.map((message, index) => (
                <article key={`${index}-${message}`} className="border-t border-line py-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
                    <span className="icon-[lucide--clock-3] size-3.5" />
                    等待当前回合结束
                  </div>
                  {editing === index ? (
                    <div className="flex gap-2">
                      <input className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="编辑排队消息" />
                      <button disabled={!draft.trim()} className={buttonClass} onClick={() => { setQueue(queue.map((item, i) => i === index ? draft : item)); setEditing(-1); }}>保存</button>
                      <button onClick={() => setEditing(-1)} className="text-[12px] text-muted">取消</button>
                    </div>
                  ) : <p className="text-[14px] leading-6">{message}</p>}
                  <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
                    <button onClick={() => { setEditing(index); setDraft(message); }} className="text-muted">编辑</button>
                    <button onClick={() => { setQueue(queue.filter((_, i) => i !== index)); setStatus(`已将“${message}”撤回到预览编辑区。`); setDraft(message); }} className="text-muted">撤回</button>
                    <button onClick={() => { setQueue(queue.filter((_, i) => i !== index)); setStatus('已记录立即发送的预览操作。'); }} className="ml-auto text-primary">立即发送</button>
                    <button onClick={() => { setQueue(queue.filter((_, i) => i !== index)); setStatus('预览已记录打断后发送；未中断任何真实任务。'); }} className="text-danger">打断并发送</button>
                    <button onClick={() => setQueue(queue.filter((_, i) => i !== index))} className="text-muted">删除</button>
                  </div>
                </article>
              ))}
              {!queue.length && <p className="border-t border-line py-12 text-center text-[13px] text-muted">没有排队消息。</p>}
              {editing === -1 && draft && <div className="mt-5 border-t border-line pt-4"><label className="mb-2 block text-[12px] text-muted">撤回内容</label><textarea className="h-20 w-full rounded-control border border-border bg-input p-3 text-[13px]" aria-label="撤回内容" value={draft} onChange={(event) => setDraft(event.target.value)} /></div>}
            </section>
          )}
          <div className="mt-8 border-t border-line pt-4 text-[11px] leading-6 text-muted">设计预览：可以切换状态并操作控件；不会授权真实工具、调用模型或修改会话数据。</div>
        </div>
      </div>
    </div>
  );
}
