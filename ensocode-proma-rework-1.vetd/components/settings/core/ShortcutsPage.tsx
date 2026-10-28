import { useEffect, useState } from 'react';
import { Kbd } from '../../Controls';
import { outlineButton, SettingsHeader } from '../SettingsUI';
import { formatBinding } from './shared';

/** 18 项，id / 默认键位 / 说明取自 src/renderer/lib/keybindings.ts */
const ACTIONS = [
  { id: 'toggle-sidebar', label: '折叠/展开侧栏', key: 'mod+b' },
  { id: 'toggle-app-mode', label: '切换 Code / Bot 模式', key: 'mod+e', hint: '需先在实验设置中开启 Bot 模式' },
  { id: 'toggle-side-panel', label: '折叠/展开右侧面板', key: 'mod+j' },
  { id: 'toggle-side-panel-fullscreen', label: '右侧面板全屏', key: 'mod+shift+j' },
  { id: 'open-settings', label: '打开设置', key: 'mod+,' },
  { id: 'switch-model', label: '切换模型', key: 'mod+.', hint: '仅在输入框聚焦时生效' },
  { id: 'focus-composer', label: '聚焦输入框', key: 'mod+l' },
  { id: 'send-message', label: '发送消息', key: 'enter', hint: '仅在输入框聚焦时生效' },
  { id: 'find-in-chat', label: '在对话中查找', key: 'mod+f' },
  { id: 'search-workspace', label: '搜索任意内容', key: 'mod+k' },
  { id: 'new-conversation', label: '新对话', key: 'mod+n' },
  { id: 'next-tab', label: '下一个 coworker 标签', key: 'ctrl+tab' },
  { id: 'prev-tab', label: '上一个 coworker 标签', key: 'ctrl+shift+tab' },
  { id: 'new-side-tab', label: '新建终端标签', key: 'mod+t', hint: '右侧面板聚焦时新建终端，否则新建对话' },
  { id: 'new-btw-tab', label: '新建旁路标签', key: 'mod+shift+b', hint: '在右侧栏打开旁路对话' },
  { id: 'close-side-tab', label: '关闭终端标签', key: 'mod+w' },
  { id: 'toggle-minimize-to-tray', label: '切换最小化到托盘', key: 'mod+shift+m', hint: '应用在托盘时也能切换' },
  { id: 'voice-hold', label: '语音输入（按住说话）', key: 'space', hint: '输入框聚焦时按住，松开后文字进入输入框' },
];
const DEFAULTS = Object.fromEntries(ACTIONS.map((action) => [action.id, action.key]));

function eventToBinding(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  if (['meta', 'control', 'shift', 'alt'].includes(key)) return null;
  const parts = [event.metaKey && 'mod', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift'].filter(Boolean) as string[];
  const name = key === ' ' ? 'space' : key;
  return [...parts, name].join('+');
}

/** 快捷键（KeybindingsSettings）：点击键位改绑；Backspace 删除；Esc 取消；冲突提示；恢复默认 */
export function ShortcutsPage() {
  const [bindings, setBindings] = useState<Record<string, string>>({ ...DEFAULTS });
  const [recording, setRecording] = useState('');
  const [conflict, setConflict] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === 'Escape') { setRecording(''); setConflict(null); return; }
      if (event.key === 'Backspace' && !event.metaKey) { setBindings({ ...bindings, [recording]: '' }); setRecording(''); setConflict(null); return; }
      const binding = eventToBinding(event);
      if (!binding) return;
      const taken = ACTIONS.find((action) => action.id !== recording && bindings[action.id] === binding);
      if (taken) { setConflict({ id: recording, label: taken.label }); return; }
      setBindings({ ...bindings, [recording]: binding });
      setRecording(''); setConflict(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, bindings]);
  const changed = ACTIONS.some((action) => bindings[action.id] !== action.key);
  return (
    <div data-settings-row="shortcuts.root">
      <SettingsHeader title="快捷键" description="点击键位改绑。Backspace 删除；Esc 取消。" actions={<button disabled={!changed} onClick={() => setBindings({ ...DEFAULTS })} className={outlineButton}><span className="icon-[lucide--rotate-ccw] size-3.5" />全部恢复默认</button>} />
      <div className="divide-y divide-line rounded-control border border-line">
        {ACTIONS.map((action) => {
          const value = bindings[action.id];
          const isRecording = recording === action.id;
          const custom = value !== action.key;
          return (
            <div key={action.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">{action.label}</p>
                {action.hint && <p className="text-[11px] text-muted">{action.hint}</p>}
                {conflict?.id === action.id && <p className="text-[11px] text-danger">已被「{conflict.label}」占用</p>}
              </div>
              {custom && !isRecording && (
                <button title="恢复默认" aria-label="恢复默认" onClick={() => setBindings({ ...bindings, [action.id]: action.key })} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--rotate-ccw] size-3.5" /></button>
              )}
              {value && !isRecording && (
                <button title="删除快捷键" aria-label="删除快捷键" onClick={() => setBindings({ ...bindings, [action.id]: '' })} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-danger"><span className="icon-[lucide--x] size-3.5" /></button>
              )}
              <button onClick={() => { setRecording(isRecording ? '' : action.id); setConflict(null); }} className={`flex h-7 min-w-[112px] items-center justify-center rounded-control border px-2 text-[12px] ${isRecording ? 'border-primary bg-primary-soft text-primary' : conflict?.id === action.id ? 'border-danger/60' : 'border-border hover:bg-hover'}`}>
                {isRecording ? '按下新快捷键…' : value ? <Kbd>{formatBinding(value)}</Kbd> : <span className="text-muted">无快捷键</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
