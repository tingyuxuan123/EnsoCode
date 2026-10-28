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

export function ModeSwitch({ className = '' }: { className?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bot = pathname.startsWith('/bot');
  const options = [
    { value: 'code', label: 'Code', icon: 'icon-[lucide--square-terminal]', to: '/' },
    { value: 'bot', label: 'Bot', icon: 'icon-[lucide--bot-message-square]', to: '/bot' },
  ];
  return (
    <div role="radiogroup" aria-label="切换 Code / Bot 模式" className={`flex h-8 items-center rounded-control bg-control/60 p-[3px] ${className}`}>
      {options.map((option) => {
        const active = (option.value === 'bot') === bot;
        return (
          <button key={option.value} role="radio" aria-checked={active} title="切换模式" onClick={() => navigate(option.to)} className={`relative flex h-full flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2.5 text-[12px] font-medium ${active ? 'bg-surface text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>
            <span className={`${option.icon} size-3.5`} />
            {option.label}
            {option.value === 'bot' && !bot && <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] text-white">2</span>}
          </button>
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
      {bot && (
        <>
          <div className="flex-1" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto w-[168px]">
              <ModeSwitch />
            </div>
          </div>
        </>
      )}
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

const railButton = 'relative flex size-9 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-surface-foreground disabled:pointer-events-none disabled:opacity-40';

/** 56px 全局图标轨：品牌 / 侧栏开关 /（收起时）搜索 / 工作区工具 / 技能与模型中心 / 询问 Enso / 设置 */
export function AppRail() {
  const { pathname } = useLocation();
  const { compact, setCompact, openSideTab, setSearchOpen, setNotice } = useWorkbench();
  const remote = pathname.startsWith('/remote');
  const bot = pathname.startsWith('/bot');
  const tools = [
    { kind: 'files', icon: 'icon-[lucide--folder-open]', label: '文件' },
    { kind: 'changes', icon: 'icon-[lucide--file-diff]', label: '改动' },
    { kind: 'terminal', icon: 'icon-[lucide--square-terminal]', label: '终端' },
    { kind: 'browser', icon: 'icon-[lucide--globe]', label: '浏览器' },
  ];
  return (
    <nav aria-label="EnsoCode" className="flex w-[56px] shrink-0 flex-col items-center gap-2 bg-panel pb-3 pt-3">
      <Link to="/" title="EnsoCode" className="mb-1 flex size-8 items-center justify-center">
        <EnsoMark className="size-6" />
      </Link>
      {!remote && (
        <button className={railButton} aria-pressed={!compact} title={compact ? '展开侧边栏 (⌘B)' : '折叠侧边栏 (⌘B)'} onClick={() => setCompact(!compact)}>
          <span className="icon-[lucide--panel-left] size-[18px]" />
        </button>
      )}
      {compact && !remote && (
        <button className={railButton} title="搜索任意内容 (⌘K)" onClick={() => setSearchOpen(true)}>
          <span className="icon-[lucide--search] size-[18px]" />
        </button>
      )}
      <div className="my-1 w-5 border-t border-border" aria-hidden />
      {!remote && !bot && tools.map((tool) => (
        <button key={tool.kind} className={railButton} title={tool.label} aria-label={tool.label} onClick={() => openSideTab(tool.kind)}>
          <span className={`${tool.icon} size-[19px]`} />
        </button>
      ))}
      <Link to="/settings-skills" className={railButton} title="技能" aria-label="技能">
        <span className="icon-[lucide--blocks] size-[19px]" />
      </Link>
      <Link to="/settings-providers" className={railButton} title="模型中心" aria-label="模型中心">
        <span className="icon-[lucide--server] size-[19px]" />
      </Link>
      <div className="flex-1" />
      <button className={`${railButton} text-primary hover:text-primary`} title="询问 Enso" aria-label="询问 Enso" onClick={() => setNotice('询问 Enso：打开一个由 Enso 系统 Agent 接手的新会话，可解答产品能力并帮你配置团队。设计预览不调用模型。')}>
        <span className="icon-[lucide--sparkles] size-[19px]" />
      </button>
      <Link to="/settings-general" className={railButton} title="设置 (⌘,)" aria-label="设置">
        <span className="icon-[lucide--settings-2] size-[19px]" />
      </Link>
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
