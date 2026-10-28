import { useState } from 'react';
import { MenuItem, MenuPanel, Spinner, useDismiss } from '../Controls';
import { useReadPanelPreset } from './preset';
import { DashedState, IconButton, ModeTabs, PreviewStates } from './PanelUI';

export type BrowserPreset = { state: 'agent' | 'manual' | 'error' | 'newtab' | 'history' | 'downloads' | 'device' };

const history = [
  { title: 'Status Line · shadcn/ui', url: 'ui.shadcn.com/docs/components/status', time: '11:38', agent: true },
  { title: 'Dockview — 拖拽停靠布局', url: 'dockview.dev/docs/overview', time: '11:22', agent: true },
  { title: 'React Router v7 文档', url: 'reactrouter.com/start/framework', time: '10:58', agent: false },
  { title: 'Tailwind CSS v4 · Theme variables', url: 'tailwindcss.com/docs/theme', time: '10:41', agent: true },
];
const downloads = [
  { name: 'enso-mark.svg', url: 'ui.shadcn.com/assets/enso-mark.svg', size: '4 KB', state: 'done' as const },
  { name: 'dockview.css', url: 'dockview.dev/dist/styles/dockview.css', size: '38 KB', state: 'done' as const },
  { name: 'react-router-7.9.1.tgz', url: 'registry.npmjs.org/react-router', size: '1.2 MB', state: 'running' as const, percent: 46 },
  { name: 'vite-build.log', url: 'localhost:5173/build.log', size: '—', state: 'failed' as const, error: '网络中断' },
];

function Page() {
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-6">
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <span className="size-7 rounded-[4px] bg-primary" />
        <span className="text-[14px] font-semibold">Status Line</span>
        <span className="ml-auto rounded-full border border-border px-2 text-[11px] text-muted">v4</span>
      </div>
      <p className="mt-4 text-[13px] leading-6 text-muted">展示模型、上下文与用量的状态条。字段可拖动排序，预设分简洁 / 默认 / 完整。</p>
      <div className="mt-4 rounded-control border border-border bg-panel p-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <span className="rounded-[4px] bg-surface px-1.5 py-0.5">Claude Sonnet 4.5</span>
          <span className="tabular-nums">↑ 48.2K ↓ 6.1K</span>
          <span className="tabular-nums">缓存 82%</span>
          <span className="tabular-nums">4 轮 · 37 步</span>
          <span className="tabular-nums">68 tok/s</span>
          <span className="rounded-[4px] bg-surface px-1.5 py-0.5">上下文 24%</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
        {['简单：模型 + 上下文', '默认：tokens / 缓存 / 轮次 / 速度 / 时长', '完整：再加额度与请求体大小', '额度段默认关闭：会轮询厂商接口'].map((item) => (
          <div key={item} className="rounded-control border border-line px-3 py-2 leading-5">{item}</div>
        ))}
      </div>
      <button className="mt-4 h-8 rounded-control bg-primary px-3 text-[12px] text-primary-foreground">Install</button>
    </div>
  );
}

/**
 * 内嵌浏览器（sidepanel/BrowserView.tsx + BrowserNewTab / BrowserDeviceToolbar / BrowserHistoryPanel / BrowserDownloadsPanel）。
 * 地址栏、前进后退、刷新；Agent 占用时顶部显示谁在用、可「我来接管」，接管后可「允许 Agent 继续」；
 * 圈选模式把页面元素发给对话；设备预览、开发者工具、浏览历史与下载都在同一面板内开。
 */
export function BrowserView() {
  const preset = useReadPanelPreset<BrowserPreset>('browser');
  const [state, setState] = useState<BrowserPreset['state']>(preset.state ?? 'agent');
  const [menu, setMenu] = useState(false);
  const [address, setAddress] = useState('localhost:5173/settings');
  const [records, setRecords] = useState<'page' | 'history' | 'downloads'>('page');
  const [device, setDevice] = useState(false);
  const ref = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const agent = state === 'agent';
  const pick = (next: BrowserPreset['state']) => {
    setState(next);
    setRecords(next === 'history' ? 'history' : next === 'downloads' ? 'downloads' : 'page');
    setDevice(next === 'device');
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        <IconButton icon="icon-[lucide--chevron-left]" label="上一步" />
        <IconButton icon="icon-[lucide--chevron-right]" label="前进" disabled />
        <IconButton icon="icon-[lucide--rotate-cw]" label="刷新" onClick={() => pick('error')} />
        <label className={`mx-1 flex h-6.5 min-w-0 flex-1 items-center gap-1.5 rounded-full border px-2 text-[12px] ${state === 'error' ? 'border-danger/50' : 'border-border'} bg-input`}>
          <span className="icon-[lucide--lock] size-3 shrink-0 text-faint" />
          <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="搜索或输入网址" className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <div ref={ref} className="relative">
          <IconButton icon="icon-[lucide--ellipsis]" label="更多操作" onClick={() => setMenu(!menu)} />
          {menu && (
            <MenuPanel label="浏览器操作" className="right-0 top-8 w-52">
              <MenuItem icon="icon-[lucide--scan-search]" label="开关圈选模式" hint="点选页面元素，作为上下文发给对话" onClick={() => setMenu(false)} />
              <MenuItem icon="icon-[lucide--monitor-smartphone]" label="设备预览" checked={device} onClick={() => { setMenu(false); pick('device'); }} />
              <MenuItem icon="icon-[lucide--wrench]" label="开发者工具" onClick={() => setMenu(false)} />
              <MenuItem icon="icon-[lucide--history]" label="浏览历史" onClick={() => { setMenu(false); pick('history'); }} />
              <MenuItem icon="icon-[lucide--download]" label="浏览器下载" onClick={() => { setMenu(false); pick('downloads'); }} />
            </MenuPanel>
          )}
        </div>
      </div>
      <div className={`flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11px] ${agent ? 'bg-warning-soft text-surface-foreground' : 'bg-panel text-muted'}`}>
        {agent ? (
          <>
            <Spinner className="size-3" />
            <span className="truncate">Agent 正在操作 · 界面实现 正在用这个标签页</span>
            <button onClick={() => pick('manual')} className="ml-auto shrink-0 rounded-control bg-surface px-2 py-0.5 text-[11px]">我来接管</button>
          </>
        ) : state === 'error' ? (
          <>
            <span className="icon-[lucide--circle-alert] size-3.5 text-danger" />
            <span>导航失败 · ERR_CONNECTION_REFUSED</span>
            <button onClick={() => pick('agent')} className="ml-auto shrink-0 text-primary">重试</button>
          </>
        ) : (
          <>
            <span className="size-1.5 rounded-full bg-success" />
            <span className="truncate">已接管 · 11:43 起由你手动控制</span>
            <button onClick={() => pick('agent')} className="ml-auto shrink-0 text-primary">允许 Agent 继续</button>
            <button className="shrink-0 text-muted hover:text-surface-foreground">在浏览器中打开</button>
          </>
        )}
      </div>
      {device && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 text-[11px]">
          <span className="text-muted">设备预览</span>
          {['响应式', '390 × 844', '768 × 1024'].map((item, index) => (
            <button key={item} className={`rounded-[4px] px-1.5 py-0.5 ${index === 0 ? 'bg-surface text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>{item}</button>
          ))}
          <span className="text-faint">125%</span>
          <button className="flex size-5 items-center justify-center text-muted hover:text-surface-foreground" title="旋转"><span className="icon-[lucide--rotate-ccw] size-3" /></button>
          <button onClick={() => setDevice(false)} className="ml-auto flex size-5 items-center justify-center text-muted hover:text-surface-foreground" title="关闭设备预览"><span className="icon-[lucide--x] size-3" /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-panel/40">
        {records === 'page' ? (
          state === 'newtab' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="icon-[lucide--compass] size-6 text-faint" />
              <p className="text-[13px] font-medium">Enso 浏览器</p>
              <p className="max-w-[260px] text-[12px] leading-5 text-muted">让 Agent 和你一起探索网页：读取页面、交互操作、测试布局，回溯记录都在同一标签里。</p>
              <div className="flex flex-wrap justify-center gap-1.5 text-[12px]">{['浏览网页', '读取页面', '交互操作', '测试布局'].map((item) => <span key={item} className="rounded-control border border-border px-2 py-1 text-muted">{item}</span>)}</div>
            </div>
          ) : state === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-muted">
              <span className="icon-[lucide--plug-zap] size-6 text-faint" />
              <p className="font-medium text-surface-foreground">导航失败</p>
              <p className="max-w-[280px] leading-5">localhost:5173 没有响应。开发服务器可能已停止，重新运行 <code>pnpm dev</code> 后再刷新。</p>
              <button onClick={() => pick('agent')} className="mt-2 rounded-control border border-border px-3 py-1 text-[12px] text-surface-foreground hover:bg-hover">重试</button>
            </div>
          ) : (
            <div className={`bg-white ${device ? 'mx-auto my-3 w-[390px] rounded-[10px] border border-border' : ''}`}>
              <Page />
            </div>
          )
        ) : records === 'history' ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-line px-3 py-2">
              <p className="text-[12px] font-medium">浏览历史</p>
              <p className="mt-0.5 text-[11px] text-muted">当前浏览器会话的访问记录。清空记录不会清除 Cookie 或退出登录。</p>
              <label className="mt-2 flex h-7 items-center gap-1.5 rounded-control border border-border bg-input px-2 text-muted"><span className="icon-[lucide--search] size-3" /><input placeholder="按标题或网址搜索历史" aria-label="搜索历史" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" /></label>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {history.map((item) => (
                <div key={item.url} className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-hover">
                  <span className="icon-[lucide--globe] size-3.5 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.title}</span>
                    <span className="block truncate text-[11px] text-faint">{item.url}</span>
                  </span>
                  {item.agent && <span className="shrink-0 rounded-[4px] bg-primary-soft px-1 text-[10px] text-primary">Agent</span>}
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{item.time}</span>
                  <button title="删除历史记录" className="shrink-0 text-muted hover:text-danger"><span className="icon-[lucide--x] size-3" /></button>
                </div>
              ))}
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[11px]">
              <span className="text-muted">请先接管，再打开历史网页。</span>
              <button onClick={() => pick('manual')} className="ml-auto rounded-control border border-border px-2 py-0.5 text-surface-foreground hover:bg-hover">接管</button>
              <button className="text-muted hover:text-surface-foreground">关闭</button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="border-b border-line px-3 py-2">
              <p className="text-[12px] font-medium">浏览器下载</p>
              <p className="mt-0.5 text-[11px] text-muted">管理当前浏览器会话的下载。删除记录不会删除已下载的实体文件。</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {downloads.map((item) => (
                <div key={item.name} className="flex items-start gap-2 px-3 py-2 text-[12px] hover:bg-hover">
                  <span className={`${item.state === 'failed' ? 'icon-[lucide--file-x] text-danger' : 'icon-[lucide--file] text-faint'} mt-0.5 size-3.5 shrink-0`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-[11px] text-faint">{item.url} · {item.size}</span>
                    {item.state === 'running' && <span className="mt-1 block h-[3px] w-full rounded-full bg-control"><span className="block h-full rounded-full bg-primary" style={{ width: `${item.percent}%` }} /></span>}
                    {item.state === 'failed' && <span className="block text-[11px] text-danger">下载失败 · {item.error}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-muted">
                    {item.state === 'running' && <button title="暂停下载"><span className="icon-[lucide--pause] size-3" /></button>}
                    {item.state === 'running' && <button title="取消下载"><span className="icon-[lucide--x] size-3" /></button>}
                    {item.state === 'done' && <button title="在文件管理器中显示"><span className="icon-[lucide--folder-search] size-3" /></button>}
                    {item.state === 'failed' && <button title="重试"><span className="icon-[lucide--rotate-cw] size-3" /></button>}
                    <button title="删除下载记录" className="hover:text-danger"><span className="icon-[lucide--trash-2] size-3" /></button>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex h-9 shrink-0 items-center justify-end border-t border-line px-3"><button className="text-[11px] text-muted hover:text-surface-foreground">关闭</button></div>
          </div>
        )}
      </div>
      <PreviewStates value={state} onChange={pick} options={[{ value: 'agent', label: 'Agent 操作中' }, { value: 'manual', label: '已接管' }, { value: 'error', label: '导航失败' }, { value: 'newtab', label: '新标签页' }, { value: 'history', label: '历史' }, { value: 'downloads', label: '下载' }]} />
    </div>
  );
}
