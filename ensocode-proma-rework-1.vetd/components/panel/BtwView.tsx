import { useState } from 'react';
import { Spinner } from '../Controls';
import { useReadPanelPreset } from './preset';
import { ModeTabs, PreviewStates, Toolbar } from './PanelUI';

const answers: Record<string, string> = {
  files: '文件面板左侧是文件树，右键可预览、复制路径、发送到对话；搜索支持「文件名」和「内容」两种模式，内容搜索走 rg，命中行会带行号跳转。',
  changes: '改动面板只统计本会话（会话模式），并排 diff 需要面板够宽；原始快照被截断的文件会单独列出，无法显示完整差异。',
  shell: '终端标签可以多开：右侧面板聚焦时 ⌘T 新建终端，否则新建对话。每个标签是独立进程，关闭标签会结束该进程，重新打开会重启 shell。',
  default: '这是旁路提问：回答只出现在这个标签里，不会写进主会话，也不会调用主 agent 的工具。带上下文会把当前会话的最近消息一起发过去；独立旁路则完全隔离。',
};
const topics: { id: string; q: string; a: string }[] = [
  { id: 'files', q: '文件面板里的「内容」搜索走的是什么？', a: answers.files },
  { id: 'changes', q: '为什么并排 diff 只在宽面板出现？', a: answers.changes },
  { id: 'shell', q: '终端标签关掉后进程还在吗？', a: answers.shell },
];

/**
 * 旁路（sidepanel/BtwView.tsx）：独立输入框、流式回答、停止；可切换「带上下文 / 独立旁路」；
 * 回答可「填入主输入框」；每开一个新旁路是一个新标签。
 */
export function BtwView() {
  const preset = useReadPanelPreset<{ state: 'ready' | 'streaming' | 'ctxx' | 'empty' }>('btw');
  const [state, setState] = useState(preset.state ?? 'ready');
  const [target, setTarget] = useState<'context' | 'isolated'>(state === 'ctxx' ? 'context' : 'context');
  const [draft, setDraft] = useState('');
  const [asked, setAsked] = useState(topics[0]);
  const [filled, setFilled] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Toolbar>
        <ModeTabs label="旁路上下文" value={target} onChange={(value) => setTarget(value)} options={[{ value: 'context', label: '带上下文' }, { value: 'isolated', label: '独立旁路' }]} />
        <span className="ml-1 text-[11px] text-muted">旁路提问，不会发给主 agent。</span>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {state === 'empty' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-[12px] text-muted">
            <span className="icon-[lucide--message-circle] size-5 text-faint" />
            新旁路标签
            <p className="max-w-[260px] leading-5">随便问点与当前任务相关的细节。回答留在本标签，不影响主线。</p>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {topics.map((topic) => <button key={topic.id} onClick={() => { setAsked(topic); setState('ready'); }} className="rounded-control border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface-foreground">{topic.q}</button>)}
            </div>
          </div>
        ) : (
          <div className="px-3 py-3">
            <div className="ml-auto mb-3 w-fit max-w-[90%] rounded-control bg-panel px-3 py-2 text-[13px] leading-5">{asked.q}</div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">
              <span className="icon-[lucide--sparkles] size-3" />
              旁路 · {target === 'context' ? '已附上当前会话最近 6 条消息' : '独立上下文'}
              {state === 'streaming' ? <span className="ml-auto flex items-center gap-1 text-primary"><Spinner className="size-3" />生成中</span> : <span className="ml-auto">仅本标签可见</span>}
            </div>
            <div className="rounded-control border border-line bg-panel/40 px-3 py-2 text-[13px] leading-6">
              {asked.a}
              {state === 'streaming' && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-primary align-middle" />}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <button onClick={() => { setFilled(true); window.setTimeout(() => setFilled(false), 1600); }} className="text-primary">{filled ? '已填入主输入框' : '填入主输入框'}</button>
              {state === 'streaming' ? (
                <button onClick={() => setState('ready')} className="text-danger">停止</button>
              ) : (
                <button onClick={() => setState('streaming')} className="text-muted hover:text-surface-foreground">重新回答</button>
              )}
              <button onClick={() => setState('empty')} className="ml-auto text-muted hover:text-surface-foreground">打开新旁路标签</button>
            </div>
            {state === 'ready' && (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-[11px] text-faint">继续问</p>
                {topics.filter((topic) => topic.id !== asked.id).map((topic) => (
                  <button key={topic.id} onClick={() => setAsked(topic)} className="mt-1 block w-full truncate rounded-control px-1 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-surface-foreground">{topic.q}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line p-2">
        <div className="rounded-control border border-border bg-input focus-within:border-primary/60">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="旁路提问…" aria-label="旁路提问输入" className="block h-[52px] w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-5 outline-none placeholder:text-faint" />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            {target === 'context' && <span className="rounded-[4px] bg-control px-1.5 py-0.5 text-[11px] text-muted">附上下文</span>}
            <span className="text-[11px] text-faint">{target === 'context' ? '最近 6 条消息' : '不带任何会话内容'}</span>
            <button disabled={!draft.trim()} onClick={() => { setAsked({ id: 'custom', q: draft, a: answers.default }); setDraft(''); setState('streaming'); }} className="ml-auto flex size-7 items-center justify-center rounded-control bg-primary text-primary-foreground disabled:opacity-35"><span className="icon-[lucide--arrow-up] size-3.5" /></button>
          </div>
        </div>
      </div>
      <PreviewStates value={state} onChange={setState} options={[{ value: 'ready', label: '已回答' }, { value: 'streaming', label: '流式中' }, { value: 'empty', label: '新旁路' }]} />
    </div>
  );
}
