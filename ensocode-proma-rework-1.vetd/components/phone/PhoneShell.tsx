import { Outlet } from 'react-router';

/**
 * 手机伴侣外壳（packages/phone）：独立移动布局 + 同一套视觉语言。
 * 390×844：顶部安全区与标题、底部输入/导航，主操作放在拇指可达处。
 * 不套桌面外壳，也不显示图标轨与状态栏。
 */
export function PhoneShell() {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="h-[44px] shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
      <div className="h-[20px] shrink-0" />
    </div>
  );
}
