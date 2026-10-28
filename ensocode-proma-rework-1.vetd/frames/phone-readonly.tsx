export const frame = { width: 390, height: 844, title: "手机 · 只读设备" };

import { Link } from 'react-router';
import { StatusDot } from '../components/Controls';

/** 只读设备：可以看与输入，但不出现审批与停止按钮；顶部常驻提示，可在桌面改权限 */
export default function PhoneReadonly() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-warning-soft px-3 text-[11px]">
        <span className="icon-[lucide--eye] size-3.5 text-warning" />
        只读设备：不能发送、审批或停止
        <Link to="/settings-phone" className="ml-auto text-primary">查看权限</Link>
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Link to="/phone-sessions" className="flex size-8 items-center justify-center text-muted"><span className="icon-[lucide--panel-left] size-4" /></Link>
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">统一工作台布局与侧栏样式</p><p className="flex items-center gap-1.5 text-[11px] text-muted"><StatusDot tone="running" size="sm" />运行中 · 只读查看</p></div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="ml-auto max-w-[85%] rounded-[14px] rounded-br-[4px] bg-panel px-3 py-2 text-[13px] leading-5">把侧栏状态点改成能看出等待审批和运行中。</div>
        <div className="max-w-[90%] rounded-[14px] rounded-bl-[4px] bg-control/50 px-3 py-2 text-[13px] leading-5">正在编辑 Sidebar.tsx 与 ConversationStatusIndicator.tsx……</div>
        <div className="flex gap-2 text-[12px] text-muted"><span className="icon-[lucide--loader-circle] vetd-spin mt-0.5 size-3.5 shrink-0 text-primary" />写文件 · +24 −18</div>
      </div>
      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="flex items-center gap-2 rounded-[14px] border border-border bg-input px-2 py-1.5 opacity-60">
          <span className="flex-1 px-1 text-[12px] text-faint">这台设备不能发送消息</span>
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-control text-muted"><span className="icon-[lucide--arrow-up] size-4" /></span>
        </div>
      </div>
    </div>
  );
}
