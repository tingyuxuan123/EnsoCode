export const frame = { width: 390, height: 844, title: "手机 · 配对电脑" };

import { useState } from 'react';

/** 配对（packages/phone/PairScreen）：扫码或粘贴配对码；摄像头不可用时手工粘贴；失败与重连 */
const dark = [0, 1, 2, 8, 10, 16, 18, 24, 26, 33, 35, 41, 46, 50, 53, 57, 59, 61, 63, 5, 12, 20, 30, 44, 55];

export default function PhonePair() {
  const [mode, setMode] = useState<'scan' | 'paste' | 'error'>('scan');
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex shrink-0 flex-col items-center gap-1.5 px-6 pt-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-[12px] bg-control"><span className="icon-[lucide--circle-dashed] size-6 text-surface-foreground" /></span>
        <p className="text-[15px] font-semibold">配对这台电脑</p>
        <p className="text-[12px] leading-5 text-muted">用桌面端「设置 → 设备」生成配对码，扫码即可打开并完成配对。</p>
      </div>
      <div className="px-6 pt-5">
        {mode === 'scan' ? (
          <div className="relative mx-auto aspect-square w-full max-w-[240px] rounded-[14px] border border-border bg-panel/50 p-3">
            <div className="grid h-full grid-cols-8 grid-rows-8 gap-0.5">
              {Array.from({ length: 64 }).map((_, index) => (
                <span key={index} className={dark.includes(index) ? 'bg-surface-foreground' : 'bg-transparent'} />
              ))}
            </div>
            <span className="absolute inset-x-8 top-1/2 h-px bg-primary/60" />
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-surface-foreground px-2 py-0.5 text-[11px] text-surface">对准二维码</span>
          </div>
        ) : mode === 'paste' ? (
          <div>
            <label className="text-[11px] text-muted">配对码 / 配对链接</label>
            <textarea defaultValue="enso://pair?code=8F2K-QP7M" rows={3} className="mt-1 block w-full rounded-control border border-border bg-input p-2.5 font-mono text-[12px] outline-none" />
          </div>
        ) : (
          <div className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-[12px] leading-5 text-danger">
            配对码已失效（60 秒）。请在桌面端重新生成，或者直接剪贴链接再试。
          </div>
        )}
      </div>
      <div className="mt-auto px-6 pb-6">
        <div className="mb-2 flex items-center justify-center gap-3 text-[11px]">
          {([['scan', '扫码'], ['paste', '粘贴配对码'], ['error', '失效']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} className={`rounded-full px-2 py-0.5 ${mode === id ? 'bg-selected text-surface-foreground' : 'text-muted'}`}>{label}</button>
          ))}
        </div>
        <button className="h-11 w-full rounded-[12px] bg-primary text-[14px] font-medium text-primary-foreground">{mode === 'paste' ? '完成配对' : mode === 'error' ? '重新配对' : '打开相机扫码'}</button>
        <p className="mt-2 text-center text-[11px] text-muted">配对后可在浏览器里添加到主屏幕</p>
      </div>
    </div>
  );
}
