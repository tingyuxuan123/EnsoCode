import { Link, Outlet, useLocation } from 'react-router';
import { settingsCategories } from '../data';
import { TrafficLights } from '../Shell';
import { Notice, useWorkbench } from '../Workbench';

/**
 * 独立设置窗口（SettingsWindow.ts：960×680，settings.tsx 入口）。
 * 标题栏「设置」+ 询问 Enso；左侧 240 分类导航，右侧内容 px-10 py-8。
 * 路由 /settings-<分类 id>；记忆/工作流跟随内置工具，Bot 两页跟随实验开关，被隐藏时也保留在设计稿中并标注条件。
 */
export function SettingsWindow() {
  const { pathname } = useLocation();
  const { botModeEnabled, setNotice } = useWorkbench();
  // 子流程帧用 /settings-<分类>--<子流程>，导航仍高亮所属分类
  const current = pathname.replace('/settings-', '').split('--')[0] || 'general';
  return (
    <>
      <header className="relative flex h-11 shrink-0 items-center bg-panel pr-3">
        <TrafficLights />
        <span className="text-[12px] font-medium text-muted">设置</span>
        <button onClick={() => setNotice('询问 Enso：打开一个由 Enso 系统 Agent 接手的会话，帮你检查或修改这些设置（设计预览）。')} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-control border border-primary/20 bg-primary/5 px-2 text-[12px] font-medium text-primary hover:bg-primary/10" title="询问 Enso" aria-label="询问 Enso">
          <span className="icon-[lucide--sparkles] size-3.5" />
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1 border-t border-line">
        <nav aria-label="设置分类" className="w-60 shrink-0 space-y-0.5 overflow-y-auto border-r border-line bg-sidebar p-2">
          {settingsCategories.map((category) => {
            const hidden = (category.id === 'bots' || category.id === 'botTemplates') && !botModeEnabled;
            if (hidden) return null;
            return (
              <Link key={category.id} to={`/settings-${category.id}`} title={category.gate} className={`flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-[13px] ${category.sub ? 'pl-7' : ''} ${current === category.id ? 'bg-selected font-medium text-surface-foreground' : 'text-muted hover:bg-hover hover:text-surface-foreground'}`}>
                <span className={`${category.icon} size-4 shrink-0`} />
                <span className="truncate">{category.label}</span>
                {category.gate && <span className="icon-[lucide--eye] ml-auto size-3 shrink-0 text-faint" aria-label={category.gate} />}
              </Link>
            );
          })}
          <Link to="/" className="mt-3 flex items-center gap-2 rounded-control px-2.5 py-1.5 text-[12px] text-faint hover:bg-hover hover:text-surface-foreground">
            <span className="icon-[lucide--arrow-left] size-3.5" />
            回到主窗口（设计稿导航）
          </Link>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto bg-surface px-10 py-8">
          <Outlet />
        </div>
        <Notice />
      </div>
    </>
  );
}
