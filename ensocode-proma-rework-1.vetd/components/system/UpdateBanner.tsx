import { useState } from 'react';
import { useLocation } from 'react-router';
import { Spinner } from '../Controls';

type State = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'failed';

/**
 * 版本更新横幅（app/UpdateBanner.tsx）：标题栏下方，一条即可；
 * 检查中 / 发现新版本 / 下载进度 / 已就绪（重启更新）/ 失败（重试）/ 关闭。
 * 设计稿只在 /system-update 显示，并允许在帧内切换状态；其他路由不占位。
 */
export function UpdateBanner() {
  const { pathname } = useLocation();
  const [state, setState] = useState<State>(pathname === '/system-update' ? 'downloading' : 'idle');
  const [percent, setPercent] = useState(46);
  const [closed, setClosed] = useState(false);
  if (pathname !== '/system-update' || closed || state === 'idle') return null;
  const tone = state === 'failed' ? 'border-danger/40 bg-danger-soft' : state === 'ready' ? 'border-success/40 bg-success-soft' : 'border-line bg-panel';
  return (
    <div className={`flex h-9 shrink-0 items-center gap-2 border-b px-4 text-[12px] ${tone}`}>
      {state === 'checking' && <><Spinner /><span>正在检查更新…</span></>}
      {state === 'available' && <><span className="icon-[lucide--download] size-3.5 text-primary" /><span>发现新版本 0.3.1</span><button onClick={() => setState('downloading')} className="ml-1 rounded-control bg-surface-foreground px-2 py-0.5 text-[11px] text-surface">下载</button></>}
      {state === 'downloading' && (
        <>
          <Spinner />
          <span>正在下载更新… {percent}%</span>
          <span className="h-[3px] w-32 overflow-hidden rounded-full bg-control"><span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></span>
          <button onClick={() => setPercent(Math.min(100, percent + 20))} className="text-[11px] text-primary">模拟进度</button>
        </>
      )}
      {state === 'ready' && <><span className="icon-[lucide--circle-check] size-3.5 text-success" /><span>新版本 0.3.1 已就绪 —— 重启以更新。</span><button onClick={() => setState('idle')} className="rounded-control bg-surface-foreground px-2 py-0.5 text-[11px] text-surface">重启更新</button><button onClick={() => setState('idle')} className="text-[11px] text-muted">稍后</button></>}
      {state === 'failed' && <><span className="icon-[lucide--circle-alert] size-3.5 text-danger" /><span>更新失败 · 无法连接更新服务器（ECC 校验通过）</span><button onClick={() => setState('downloading')} className="rounded-control border border-border px-2 py-0.5 text-[11px]">重试</button></>}
      <span className="ml-auto" />
      <div className="flex items-center gap-0.5 rounded-[4px] border border-dashed border-border px-1 py-0.5 text-[10px] text-faint">
        <span className="mr-0.5">预览状态</span>
        {([['checking', '检查'], ['available', '有新版'], ['downloading', '下载'], ['ready', '已就绪'], ['failed', '失败']] as [State, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setState(id)} className={`rounded-[3px] px-1 ${state === id ? 'bg-surface text-surface-foreground' : 'hover:text-surface-foreground'}`}>{label}</button>
        ))}
      </div>
      <button onClick={() => setClosed(true)} aria-label="关闭更新提示" className="flex size-6 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--x] size-3.5" /></button>
    </div>
  );
}
