import { Outlet, useLocation } from 'react-router';
import { Inspector, Navigation, Notice, WindowBar, WorkbenchProvider, useWorkbench } from '../components/Workbench';

function Shell() {
  const { pathname } = useLocation();
  const { inspectorOpen } = useWorkbench();
  const showInspector = inspectorOpen && ['/', '/task-progress', '/background-agents'].includes(pathname);
  // 56 + 264 + 808 + 312 = 1440；面板关闭时主区自动扩展。
  return (
    <>
      <WindowBar />
      <div className="relative flex min-h-0 flex-1">
        <Navigation />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
          <Outlet />
        </main>
        {showInspector && <Inspector />}
        <Notice />
      </div>
      <footer className="flex h-[24px] shrink-0 items-center gap-2 border-t border-line bg-panel px-4 text-[11px] text-muted">
        <span className="icon-[lucide--circle-check] size-3" />
        本地工作区
        <span className="mx-2 text-border">|</span>
        设计预览 · 示例数据
        <span className="ml-auto">数据留在本机</span>
        <span className="icon-[lucide--shield-check] ml-1 size-3" />
      </footer>
    </>
  );
}
export default function Layout() {
  return <WorkbenchProvider><Shell /></WorkbenchProvider>;
}
