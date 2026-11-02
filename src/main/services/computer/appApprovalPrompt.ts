import type { ComputerAppIdentity } from '@shared/computer/types';
import { app, dialog } from 'electron';
import type { AppPromptAnswer } from './appAuthorization';

/**
 * 首次操作某个 app 时由用户确认；勾选「始终允许」才落入名单。
 * 必须挂在窗口上：macOS 无父窗口的消息框同步运行，会卡住整个 Main，也无法被 signal 关闭。
 */
export async function promptComputerAppAccess(
  target: ComputerAppIdentity,
  signal: AbortSignal
): Promise<AppPromptAnswer> {
  const zh = app.getLocale().toLowerCase().startsWith('zh');
  const name = app.getName() || 'EnsoCode';
  const options = {
    type: 'question' as const,
    message: zh
      ? `允许 ${name} 操作「${target.name}」？`
      : `Allow ${name} to control “${target.name}”?`,
    detail: zh
      ? `此授权允许 AI 对「${target.name}」执行点击、输入及其他操作（包括后台操作）。截图和辅助功能内容读取不受此授权控制。\n${target.path}`
      : `This allows the AI to click, type, and perform other actions in “${target.name}”, including in the background. Screenshots and accessibility reads are not controlled by this permission.\n${target.path}`,
    buttons: zh ? ['允许', '拒绝'] : ['Allow', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    checkboxLabel: zh
      ? '始终允许此应用（可在 设置 → 工具 → Computer 中撤销）'
      : 'Always allow this app (revoke in Settings → Tools → Computer)',
    checkboxChecked: false,
    signal,
  };
  // 按需加载：主窗口模块牵连更新器等，computer 宿主加载时不该带上它们
  const { focusMainWindow, getMainWindow } = await import('../../windows/MainWindow');
  const current = getMainWindow();
  const parent =
    current && !current.isDestroyed() && current.isVisible() && !current.isMinimized()
      ? current
      : focusMainWindow();
  const result = await dialog.showMessageBox(parent, options);
  if (signal.aborted) return 'dismissed';
  if (result.response !== 0) return 'deny';
  return result.checkboxChecked ? 'always' : 'once';
}
