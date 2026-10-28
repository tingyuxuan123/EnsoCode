import { useState } from 'react';
import { useReadPanelPreset } from './preset';

const shellOut = [
  { text: '~/githubproject/EnsoCode  main', tone: 'path' },
  { text: '', tone: 'plain' },
  { text: '$ pnpm test', tone: 'cmd' },
  { text: ' ✓ src/shared/settingsDeepLink.test.ts (8)', tone: 'ok' },
  { text: ' ✓ src/renderer/components/settings/settingsCategories.test.ts (6)', tone: 'ok' },
  { text: ' Test Files  2 passed (2)', tone: 'ok' },
  { text: '      Tests  14 passed (14)', tone: 'ok' },
  { text: '   Duration  2.41s', tone: 'faint' },
  { text: '', tone: 'plain' },
  { text: '$ pnpm typecheck', tone: 'cmd' },
  { text: '类型检查通过', tone: 'ok' },
  { text: '', tone: 'plain' },
  { text: '$ ▍', tone: 'cmd' },
];
const runningOut = [
  { text: '~/githubproject/EnsoCode  main', tone: 'path' },
  { text: '$ pnpm dev', tone: 'cmd' },
  { text: ' VITE v7.1.4  ready in 812 ms', tone: 'ok' },
  { text: ' ➜  Local:   http://localhost:5173/', tone: 'primary' },
  { text: ' ➜  press h + enter to show help', tone: 'faint' },
  { text: '', tone: 'plain' },
  { text: '11:42:08 [vite] hmr update /src/renderer/components/chat/Sidebar.tsx', tone: 'faint' },
  { text: '11:42:19 [vite] hmr update /src/renderer/styles/globals.css', tone: 'faint' },
  { text: '$ ▍', tone: 'cmd' },
];
const sshOut = [
  { text: 'ssh deploy@relay-host  /srv/relay-service  main', tone: 'path' },
  { text: '$ systemctl status enso-relay', tone: 'cmd' },
  { text: '● enso-relay.service - Enso relay (go)', tone: 'plain' },
  { text: '     Active: active (running) since Tue 2026-10-27 09:12:04 CST', tone: 'ok' },
  { text: '   Main PID: 4412 (relay)', tone: 'plain' },
  { text: '', tone: 'plain' },
  { text: '$ journalctl -u enso-relay -n 3 --no-pager', tone: 'cmd' },
  { text: '10-27 11:38 relay: pair ok node=mac-mini rtt=18ms', tone: 'faint' },
  { text: '10-27 11:39 relay: sync frames=248 bytes=1.2MB', tone: 'faint' },
  { text: '10-27 11:40 relay: keepalive node=mac-mini', tone: 'faint' },
  { text: '$ ▍', tone: 'cmd' },
];
const tone: Record<string, string> = { path: 'text-muted', plain: '', cmd: 'text-surface-foreground', ok: 'text-success', faint: 'text-faint', primary: 'text-primary' };

/**
 * 终端（sidepanel/TerminalView.tsx）：xterm 输出、搜索条（⌘F）、复制、发送到对话、
 * 结束/重启；同一会话可多开（终端 2 / 终端 3）；SSH 项目跑远端 shell。
 */
export function TerminalView({ title = '终端' }: { title?: string }) {
  const preset = useReadPanelPreset<{ state: 'ready' | 'running' | 'ssh' | 'ended' | 'search' | 'empty' }>('terminal');
  const [state, setState] = useState(preset.state ?? 'ready');
  const lines = state === 'running' ? runningOut : state === 'ssh' ? sshOut : shellOut;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5 truncate">
          <span className={`size-1.5 rounded-full ${state === 'ended' ? 'bg-faint' : 'bg-success'}`} />
          {state === 'ssh' ? 'remote · deploy@relay-host' : 'zsh'}
        </span>
        <span className="ml-auto" />
        <button onClick={() => setState(state === 'search' ? 'ready' : 'search')} aria-pressed={state === 'search'} title="搜索 (⌘F)" className={`flex size-6 items-center justify-center rounded-control hover:bg-hover ${state === 'search' ? 'bg-control text-surface-foreground' : ''}`}><span className="icon-[lucide--search] size-3.5" /></button>
        <button onClick={() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }} title="复制" className="flex size-6 items-center justify-center rounded-control hover:bg-hover"><span className={`${copied ? 'icon-[lucide--check] text-success' : 'icon-[lucide--copy]'} size-3.5`} /></button>
        <button title="发送到对话" className="flex size-6 items-center justify-center rounded-control hover:bg-hover"><span className="icon-[lucide--message-square-plus] size-3.5" /></button>
        <button onClick={() => setState(state === 'ended' ? 'ready' : 'ended')} title={state === 'ended' ? '重启终端' : '结束终端'} className="flex size-6 items-center justify-center rounded-control hover:bg-hover hover:text-danger"><span className={`${state === 'ended' ? 'icon-[lucide--rotate-cw]' : 'icon-[lucide--square-x]'} size-3.5`} /></button>
      </div>
      {state === 'search' && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 text-[11px]">
          <span className="icon-[lucide--search] size-3 text-muted" />
          <input defaultValue="pnpm" readOnly aria-label="搜索终端输出" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
          <span className="text-faint">1/3</span>
          <button className="text-muted hover:text-surface-foreground"><span className="icon-[lucide--chevron-up] size-3.5" /></button>
          <button className="text-muted hover:text-surface-foreground"><span className="icon-[lucide--chevron-down] size-3.5" /></button>
          <button onClick={() => setState('ready')} className="text-muted hover:text-surface-foreground"><span className="icon-[lucide--x] size-3.5" /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {state === 'empty' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12px] text-muted">
            <span className="icon-[lucide--terminal] size-5 text-faint" />
            终端尚未启动
            <button onClick={() => setState('running')} className="rounded-control border border-border px-3 py-1 text-[12px] text-surface-foreground hover:bg-hover">启动终端</button>
          </div>
        ) : (
          <pre className="font-mono text-[11.5px] leading-[20px]">
            {lines.map((line, index) => <div key={index} className={tone[line.tone]}>{line.text || ' '}</div>)}
          </pre>
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line px-2 text-[11px] text-faint">
        <span>{state === 'ended' ? '进程已结束 · 退出码 1' : state === 'ssh' ? 'SSH · 远端登录 shell' : '本地 shell'}</span>
        <span className="ml-auto">{title} · 可多开，每个标签独立进程</span>
      </div>
    </div>
  );
}
