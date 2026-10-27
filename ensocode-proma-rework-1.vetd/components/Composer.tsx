import { useState, type KeyboardEvent } from 'react';
import { models } from './data';
import { useWorkbench } from './Workbench';

export function Composer({ onSend, initial = '' }: { onSend: (text: string) => void; initial?: string }) {
  const { model, setModel, approval, setApproval, setNotice } = useWorkbench();
  const [draft, setDraft] = useState(initial);
  const [reasoning, setReasoning] = useState(true);
  const [attachment, setAttachment] = useState(false);
  const send = () => {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <section aria-label="消息输入" className="shrink-0 px-5 pb-3 pt-2">
      {attachment && (
        <div className="mb-2 flex items-center gap-2 text-[11px] text-primary">
          <span className="icon-[lucide--file-code-2] size-3.5" />
          Sidebar.tsx · 示例引用
          <button aria-label="移除引用" onClick={() => setAttachment(false)}><span className="icon-[lucide--x] size-3" /></button>
        </div>
      )}
      <div className="rounded-control border border-border bg-input focus-within:border-primary/60">
        <textarea aria-label="输入消息" placeholder="描述下一步任务，@ 引用文件，/ 使用技能…" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} className="block h-[86px] w-full bg-transparent px-4 pb-2 pt-3.5 text-[14px] leading-6 outline-none placeholder:text-faint" />
        <div className="flex h-11 items-center gap-1.5 px-2.5">
          <button aria-label="添加文件引用" title="添加文件引用" onClick={() => setAttachment(!attachment)} className={`flex size-7 items-center justify-center rounded-control hover:bg-hover ${attachment ? 'text-primary' : 'text-muted'}`}>
            <span className="icon-[lucide--paperclip] size-[17px]" />
          </button>
          <button aria-label="切换深度思考" title={reasoning ? '深度思考已开启' : '深度思考已关闭'} aria-pressed={reasoning} onClick={() => setReasoning(!reasoning)} className={`flex size-7 items-center justify-center rounded-control hover:bg-hover ${reasoning ? 'text-primary' : 'text-muted'}`}>
            <span className="icon-[lucide--brain] size-[17px]" />
          </button>
          <button aria-label="技能与工具" title="技能与工具" onClick={() => setNotice('可在输入框使用 /skill: 引用技能，或 @ 引用文件。本稿不调用真实工具。')} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover">
            <span className="icon-[lucide--zap] size-4" />
          </button>
          <select aria-label="审批模式" value={approval} onChange={(event) => setApproval(event.target.value)} className="ml-1 max-w-[130px] rounded-control bg-transparent py-1 text-[11px] text-muted outline-none">
            <option>自动接受编辑</option><option>全程审批</option><option>完全放行</option>
          </select>
          <div className="flex-1" />
          <span className="icon-[lucide--sparkle] size-3.5 shrink-0 text-primary" />
          <select aria-label="选择模型" value={model} onChange={(event) => setModel(event.target.value)} className="max-w-[180px] rounded-control bg-transparent py-1 text-[11px] text-muted outline-none">
            {models.map((name) => <option key={name}>{name}</option>)}
          </select>
          <button aria-label="发送消息" title="发送消息" disabled={!draft.trim()} onClick={send} className="ml-2 flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-foreground text-surface hover:opacity-80 disabled:bg-control disabled:text-muted">
            <span className="icon-[lucide--arrow-up] size-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center text-[11px] text-faint">
        <span>Enter 发送 · Shift Enter 换行</span>
        <span className="ml-auto">上下文 24% <span className="ml-2 inline-block h-[3px] w-12 rounded-full bg-control align-middle"><span className="block h-full w-1/4 rounded-full bg-primary/70" /></span></span>
      </div>
    </section>
  );
}
