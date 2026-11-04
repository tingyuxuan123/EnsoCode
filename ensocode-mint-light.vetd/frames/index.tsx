export const frame = { width: 1440, height: 900, title: "薄荷白 · 编程工作台" };

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router';
import mark from '../assets/enso-mark.svg';
import { sessions } from '../components/data';
import { ChangesDock, GitReceipt } from '../components/GitReceipt';
import type { ShellState } from '../components/Shell';

const prompts = ['看看回归测试改了什么', '总结本次改动的影响'];

function Conversation({ sessionId, initialReview }: { sessionId: string; initialReview: boolean }) {
  const session = sessions.find((entry) => entry.id === sessionId);
  const isReview = sessionId === 'dock';
  const [reviewOpen, setReviewOpen] = useState(isReview && initialReview);
  const [fileIndex, setFileIndex] = useState(1);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const dockButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  function openReview(index?: number) {
    if (index !== undefined) setFileIndex(index);
    setReviewOpen(true);
  }

  function closeReview() {
    setReviewOpen(false);
    dockButton.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages((previous) => [...previous, draft.trim()]);
    setDraft('');
    input.current?.focus();
  }

  return (
    <main className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[57px] shrink-0 items-center justify-between gap-4 border-b border-line px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="icon-[lucide--folder-open] size-4 shrink-0 text-quiet" />
            <span className="text-[12px] text-muted">EnsoCode</span>
            <span className="icon-[lucide--chevron-right] size-3.5 shrink-0 text-quiet" />
            <h1 className="truncate text-[16px] font-semibold">{session?.title ?? '新建任务'}</h1>
          </div>
          {isReview && (
            <button ref={dockButton} type="button" aria-label={reviewOpen ? '关闭右侧改动面板' : '打开右侧改动面板'} aria-expanded={reviewOpen} aria-controls={reviewOpen ? 'changes-dock' : undefined} title="改动面板" onClick={() => setReviewOpen(!reviewOpen)} className={`grid size-9 shrink-0 place-items-center rounded-control ${reviewOpen ? 'bg-mint text-primary' : 'text-muted hover:bg-inset'}`}>
              <span className="icon-[lucide--panel-right] size-[18px]" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-7">
          <div className="mx-auto w-full max-w-[760px]">
            {isReview ? (
              <>
                <div className="mb-6 flex justify-end">
                  <div className="max-w-[90%] rounded-card rounded-br-[6px] bg-inset px-4 py-3 text-[14px] leading-6">打开设计画布时，不要把当前会话盖住。手动全屏的入口保留。</div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-mint">
                    <img src={mark} alt="" className="size-8" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[16px] font-semibold">Enso Agent</span>
                      <span className="text-[12px] text-quiet">主会话</span>
                    </div>
                    <p className="mt-1 text-[14px] leading-6 text-muted">已将「展开」与「全屏」拆开，展开时保留会话区和输入框。</p>
                    <GitReceipt onReview={openReview} expanded={reviewOpen} />
                    <div className="mt-4 flex flex-wrap gap-2" aria-label="后续提问">
                      {prompts.map((prompt) => (
                        <button type="button" key={prompt} className="flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-[12px] font-medium text-muted hover:border-rim hover:bg-mint hover:text-primary" onClick={() => { setDraft(prompt); input.current?.focus(); }}>
                          {prompt}
                          <span className="icon-[lucide--arrow-up-right] size-3.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-14">
                <h2 className="font-display text-[28px] font-bold">{session?.title ?? '开始一项新任务'}</h2>
                <p className="mt-2 text-[14px] leading-6 text-muted">{session ? `${session.summary}。此会话只展示提交索引。` : '在输入框描述要完成的工作。主题预览不会发送给模型。'}</p>
                {session && <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-panel px-3 py-2 text-[12px] text-muted"><span className="icon-[lucide--git-commit-horizontal] size-4" />{session.commit}</span>}
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className="mt-5 flex flex-col items-end gap-1.5">
                <p className="max-w-[90%] whitespace-pre-wrap break-words rounded-card rounded-br-[6px] bg-inset px-4 py-3 text-[14px] leading-6">{message}</p>
                <span className="text-[12px] text-quiet">仅记在预览中，未发送给模型</span>
              </div>
            ))}
            <div ref={end} />
          </div>
        </div>
        <div className="shrink-0 px-6 pb-5 pt-2">
          <div className="mx-auto w-full max-w-[760px]">
            <form onSubmit={submit} className="rounded-card border border-rim bg-surface px-4 pb-3 pt-3.5 focus-within:border-primary/55">
              <textarea ref={input} aria-label="输入消息" placeholder="描述任务，或继续追问…" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} className="block w-full resize-none bg-transparent text-[14px] leading-6 placeholder:text-quiet focus-visible:outline-none" />
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[12px] text-muted">
                  <span className="icon-[lucide--folder-open] size-3.5" />
                  EnsoCode
                </span>
                <button type="submit" disabled={!draft.trim()} aria-label="发送预览消息" title="发送预览消息" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-inset disabled:text-quiet">
                  <span className="icon-[lucide--arrow-up] size-[18px]" />
                </button>
              </div>
            </form>
            <div className="mt-2 flex justify-between gap-2 px-1 text-[12px] text-quiet">
              <span>主题预览 · 不连接模型</span>
              <Link to="/appearance" className="rounded text-muted hover:text-primary">查看主题样式</Link>
            </div>
          </div>
        </div>
      </div>
      {reviewOpen && <ChangesDock fileIndex={fileIndex} onSelect={setFileIndex} onClose={closeReview} />}
    </main>
  );
}

export default function Workbench() {
  const { sessionId } = useOutletContext<ShellState>();
  const { state, key } = useLocation();
  return <Conversation key={`${key}:${sessionId}`} sessionId={sessionId} initialReview={state?.review === true} />;
}
