import { Outlet, useLocation } from 'react-router';
import { BotShell } from '../components/bot/BotShell';
import { PhoneShell } from '../components/phone/PhoneShell';
import { ProjectDialogs } from '../components/ProjectDialogs';
import { RemoteShell } from '../components/remote/RemoteShell';
import { SearchDialog } from '../components/SearchDialog';
import { SettingsWindow } from '../components/settings/SettingsWindow';
import { UpdateBanner } from '../components/system/UpdateBanner';
import { AppRail, CodeSidebar, Notice, SidePanel, StatusBar, TitleBar, WorkbenchProvider } from '../components/Workbench';

/**
 * 路由前缀决定外壳：
 * - /settings*  独立设置窗口（真实应用为 960×680 的单独窗口）
 * - /bot*       Bot 模式：标题栏居中模式切换 + 图标轨 + Bot 侧栏
 * - /remote*    远程节点：整块换成对方的目录与会话
 * - /phone*     手机伴侣：独立移动布局，不套桌面外壳
 * - 其余        Code 模式主窗口：56 图标轨 + 264 侧栏 + 对话 + 360 右侧停靠面板
 */
function Shell() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/phone')) return <PhoneShell />;
  if (pathname.startsWith('/settings')) return <SettingsWindow />;
  const bot = pathname.startsWith('/bot');
  const remote = pathname.startsWith('/remote');
  return (
    <>
      <TitleBar />
      <UpdateBanner />
      <div className="relative flex min-h-0 flex-1">
        <AppRail />
        {bot ? (
          <BotShell />
        ) : remote ? (
          <RemoteShell />
        ) : (
          <>
            <CodeSidebar />
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden border-l border-t border-line">
              <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
                <Outlet />
              </main>
              <SidePanel />
            </div>
          </>
        )}
        <Notice />
      </div>
      <StatusBar />
      {!bot && !remote && <ProjectDialogs />}
      <SearchDialog />
    </>
  );
}

export default function Layout() {
  return (
    <WorkbenchProvider>
      <Shell />
    </WorkbenchProvider>
  );
}
