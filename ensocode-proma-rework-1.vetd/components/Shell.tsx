import { type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import ensoMark from '../assets/enso-mark.svg';
import { useWorkbench } from './Workbench';

/** 图标轨与标题栏共用的品牌标记（build/enso-mark.svg） */
export function EnsoMark({ className = 'size-6' }: { className?: string }) {
  return <img src={ensoMark} alt="" className={`enso-mark ${className}`} />;
}

/** macOS 红绿灯占位，真实窗口由系统绘制 */
export function TrafficLights() {
  return (
    <div className="flex w-[84px] shrink-0 items-center gap-[8px] pl-[16px]" aria-hidden>
      <span className="size-[12px] rounded-full bg-danger/70" />
      <span className="size-[12px] rounded-full bg-warning/70" />
      <span className="size-[12px] rounded-full bg-success/70" />
    </div>
  );
}

/** 图标轨上按钮的右侧悬浮提示：图标不带文字，名称与快捷键放在气泡里（hover 才出现） */
export function RailTip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
  return (
    <span className="group/rail relative flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-[44px] top-1/2 z-50 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-[6px] border border-line bg-surface px-2 py-1 text-[12px] text-surface-foreground shadow-md group-hover/rail:flex"
      >
        {label}
        {shortcut && <span className="text-[11px] text-faint">{shortcut}</span>}
      </span>
    </span>
  );
}

/** 图标轨里的 Code / Bot 入口（竖排两个图标）；Code 时 Bot 图标右上角显示待处理数 */
export function ModeSwitch({ className = '' }: { className?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bot = pathname.startsWith('/bot');
  const options = [
    { value: 'code', label: 'Code', icon: 'icon-[lucide--square-terminal]', to: '/' },
    { value: 'bot', label: 'Bot', icon: 'icon-[lucide--bot-message-square]', to: '/bot' },
  ];
  return (
    <div role="radiogroup" aria-label="切换 Code / Bot 模式" aria-orientation="vertical" className={`flex shrink-0 flex-col gap-2 ${className}`}>
      {options.map((option) => {
        const active = (option.value === 'bot') === bot;
        return (
          <RailTip key={option.value} label={option.label} shortcut="⌘⇧M">
            <button
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              onClick={() => navigate(option.to)}
              className={`relative flex size-9 items-center justify-center rounded-[6px] transition-colors ${active ? 'text-primary' : 'text-muted hover:bg-hover hover:text-surface-foreground'}`}
            >
              {active && <span aria-hidden className="absolute inset-0 rounded-[6px] bg-primary-soft" />}
              <span className={`relative ${option.icon} size-[19px]`} />
              {option.value === 'bot' && !bot && <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] text-white">2</span>}
            </button>
          </RailTip>
        );
      })}
    </div>
  );
}

const titles: Record<string, string> = {
  '/': '统一工作台布局与侧栏样式',
  '/task-progress': '统一工作台布局与侧栏样式',
  '/background-agents': '统一工作台布局与侧栏样式',
  '/approvals': '统一工作台布局与侧栏样式',
  '/ask-user': '统一工作台布局与侧栏样式',
  '/plan-mode': '规划设置页重构',
  '/goal-queue': '统一工作台布局与侧栏样式',
  '/model-picker': '统一工作台布局与侧栏样式',
  '/review': '统一工作台布局与侧栏样式',
  '/new-task': '新对话',
  '/projects': '统一工作台布局与侧栏样式',
  '/search': '统一工作台布局与侧栏样式',
};

/** 主窗口标题栏：WorkbenchTitle + 右侧「阅读宽度 / 右侧面板」两个动作；Bot 模式居中放模式切换 */
export function TitleBar() {
  const { pathname } = useLocation();
  const { inspectorOpen, setInspectorOpen, chatWide, setChatWide } = useWorkbench();
  const bot = pathname.startsWith('/bot');
  const remote = pathname.startsWith('/remote');
  const title = titles[pathname] ?? (pathname.startsWith('/panel') ? '统一工作台布局与侧栏样式' : '统一工作台布局与侧栏样式');
  return (
    <header className="relative flex h-11 shrink-0 items-center bg-panel pr-3">
      <TrafficLights />
      {!bot && !remote && (
        <div className="flex min-w-0 flex-1 items-center">
          <span className="w-[230px] shrink-0 truncate text-[12px] font-medium text-muted">
            EnsoCode
            <span className="ml-2 font-normal text-faint">工作台</span>
          </span>
          <div className="flex min-w-0 items-center gap-2 px-2">
            <span className="truncate text-[13px] font-medium">{title}</span>
            <span className="shrink-0 rounded-control bg-control/70 px-2 py-0.5 text-[11px] text-muted">EnsoCode</span>
          </div>
        </div>
      )}
      {remote && <span className="flex-1 text-[12px] font-medium text-muted">EnsoCode</span>}
      {bot && <span className="flex-1 text-[12px] font-medium text-muted">EnsoCode</span>}
      <div className="ml-auto flex items-center gap-1">
        <button className={`flex size-7 items-center justify-center rounded-control hover:bg-hover ${chatWide ? 'text-surface-foreground' : 'text-muted'}`} onClick={() => setChatWide(!chatWide)} aria-label={chatWide ? '恢复两侧留白' : '铺满两侧'} title={chatWide ? '恢复两侧留白' : '铺满两侧'}>
          <span className={`${chatWide ? 'icon-[lucide--fold-horizontal]' : 'icon-[lucide--unfold-horizontal]'} size-4`} />
        </button>
        {!remote && (
          <button className={`flex size-7 items-center justify-center rounded-control hover:bg-hover ${inspectorOpen ? 'text-surface-foreground' : 'text-muted'}`} onClick={() => setInspectorOpen(!inspectorOpen)} aria-label="切换右侧面板" title="切换右侧面板 (⌘J)">
            <span className="icon-[lucide--panel-right] size-4" />
          </button>
        )}
      </div>
    </header>
  );
}
/** 兼容旧名称 */
export const WindowBar = TitleBar;

const railButton = 'relative flex size-9 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-hover hover:text-surface-foreground disabled:pointer-events-none disabled:opacity-40';

/** 56px 全局图标轨：品牌 / 侧栏开关 /（收起时）搜索 / 分隔线 / Code·Bot / 询问 Enso / 设置；图标不带文字 */
export function AppRail() {
  const { pathname } = useLocation();
  const { compact, setCompact, setSearchOpen, setNotice, botModeEnabled } = useWorkbench();
  const remote = pathname.startsWith('/remote');
  return (
    <nav aria-label="EnsoCode" className="flex w-[56px] shrink-0 flex-col items-center gap-2 bg-panel pb-3 pt-3">
      <Link to="/" title="EnsoCode" aria-label="EnsoCode" className="mb-1 flex size-8 items-center justify-center">
        <EnsoMark className="size-6" />
      </Link>
      {!remote && (
        <RailTip label={compact ? '展开侧边栏' : '折叠侧边栏'} shortcut="⌘B">
          <button className={railButton} aria-pressed={!compact} aria-label={compact ? '展开侧边栏' : '折叠侧边栏'} onClick={() => setCompact(!compact)}>
            <span className="icon-[lucide--panel-left] size-[18px]" />
          </button>
        </RailTip>
      )}
      {compact && !remote && (
        <RailTip label="搜索任意内容" shortcut="⌘K">
          <button className={railButton} aria-label="搜索任意内容" onClick={() => setSearchOpen(true)}>
            <span className="icon-[lucide--search] size-[18px]" />
          </button>
        </RailTip>
      )}
      {!remote && <div data-slot="app-rail-separator" className="my-1 w-5 border-t border-line" aria-hidden />}
      {botModeEnabled && !remote && <ModeSwitch />}
      <div className="flex-1" />
      <RailTip label="询问 Enso">
        <button className={`${railButton} text-primary hover:text-primary`} aria-label="询问 Enso" onClick={() => setNotice('询问 Enso：打开一个由 Enso 系统 Agent 接手的新会话，可解答产品能力并帮你配置团队。设计预览不调用模型。')}>
          <span className="icon-[lucide--sparkles] size-[19px]" />
        </button>
      </RailTip>
      <RailTip label="设置" shortcut="⌘,">
        <Link to="/settings-general" className={railButton} aria-label="设置">
          <span className="icon-[lucide--settings-2] size-[19px]" />
        </Link>
      </RailTip>
    </nav>
  );
}

/** 窗口底部 24px 只读状态栏：当前节点、待处理 / 运行中会话数、数据留在本机 */
export function StatusBar() {
  const { pathname } = useLocation();
  const remote = pathname.startsWith('/remote');
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-4 text-[11px] text-muted">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`size-1.5 shrink-0 rounded-full ${remote ? 'bg-success' : 'bg-success'}`} />
        <span className={`${remote ? 'icon-[lucide--monitor]' : 'icon-[lucide--laptop]'} size-3.5 shrink-0`} />
        <span className="truncate">{remote ? '工作室 Mac mini' : '本地工作区'}</span>
      </span>
      <span className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-warning">
          <span className="icon-[lucide--shield-alert] size-3.5" />
          1 个待处理
        </span>
        <span className="flex items-center gap-1.5">
          <span className="icon-[lucide--loader-circle] vetd-spin size-3.5 text-primary" />
          1 个运行中
        </span>
        {!remote && (
          <span className="flex items-center gap-1">
            数据留在本机
            <span className="icon-[lucide--shield-check] size-3" />
          </span>
        )}
      </span>
    </footer>
  );
}

/** 设计预览的说明 toast（真实应用为 ToastProvider） */
export function Notice() {
  const { notice, setNotice } = useWorkbench();
  if (!notice) return null;
  return (
    <div className="absolute bottom-9 left-1/2 z-[60] flex w-[520px] max-w-[80%] -translate-x-1/2 items-start gap-3 rounded-control border border-border bg-surface p-4 text-[13px] leading-6 shadow-[0_8px_24px_rgba(20,40,60,0.12)]" role="status">
      <span className="icon-[lucide--info] mt-1 size-4 shrink-0 text-primary" />
      <p className="flex-1">{notice}</p>
      <button aria-label="关闭提示" className="mt-1 text-muted" onClick={() => setNotice('')}><span className="icon-[lucide--x] size-4" /></button>
    </div>
  );
}
