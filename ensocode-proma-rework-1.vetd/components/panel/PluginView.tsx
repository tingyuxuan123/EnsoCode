import { useState } from 'react';

/** 对照 examples/plugins/notes；只演示本地状态，不加载插件或写磁盘。 */
export function PluginView() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <div className="h-full overflow-auto p-3 text-[13px]">
      <label htmlFor="plugin-note" className="block leading-6">本地便签（卸载插件同时删除）</label>
      <textarea
        id="plugin-note"
        maxLength={8000}
        value={text}
        onChange={(event) => { setText(event.target.value); setSaved(false); }}
        className="mt-1 min-h-44 w-full rounded-control border border-border bg-transparent p-2 outline-none focus:border-primary"
      />
      <button onClick={() => setSaved(true)} className="mt-2 rounded-control border border-border px-3 py-1.5 hover:bg-hover">保存</button>
      <p role="status" className="mt-2 text-[12px] text-muted">{saved ? '已保存（仅设计预览，不写磁盘）' : ''}</p>
    </div>
  );
}
