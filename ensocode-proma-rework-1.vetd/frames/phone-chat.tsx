export const frame = { width: 390, height: 844, title: "手机 · 编程会话（审批与提问）" };

import { Link } from 'react-router';
import { StatusDot } from '../components/Controls';

/** 手机编程会话（ChatScreen）：消息流、工具调用摘要、审批/提问条、输入与插话、停止；审批在拇指可达处 */
export default function PhoneChat() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Link to="/phone-sessions" className="flex size-8 items-center justify-center rounded-control text-muted"><span className="icon-[lucide--panel-left] size-4" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">统一工作台布局与侧栏样式</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted"><StatusDot tone="waiting" size="sm" />等待你处理 · EnsoCode</p>
        </div>
        <Link to="/phone-config" className="flex size-8 items-center justify-center rounded-control text-muted"><span className="icon-[lucide--sliders-horizontal] size-4" /></Link>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="ml-auto max-w-[85%] rounded-[14px] rounded-br-[4px] bg-panel px-3 py-2 text-[13px] leading-5">把侧栏状态点改成能看出等待审批和运行中。</div>
        <div className="flex gap-2 text-[12px] text-muted"><span className="icon-[lucide--circle-check] size-3.5 shrink-0 text-success" /><span>读了 4 个文件 · 编辑 2 个 · 1 次命令失败</span></div>
        <div className="max-w-[90%] rounded-[14px] rounded-bl-[4px] bg-control/50 px-3 py-2 text-[13px] leading-5">状态点已改：运行中转圈、等待审批红点、提问黄点。要跑一次测试确认吗？</div>
        <div className="rounded-[12px] border border-warning/40 bg-warning-soft px-3 py-2 text-[12px]">
          <p className="flex items-center gap-1.5 font-medium"><span className="icon-[lucide--shield-alert] size-3.5 text-warning" />需要审批 · bash</p>
          <p className="mt-1 break-all font-mono text-[11px]">pnpm test -- --run</p>
          <div className="mt-2 flex items-center gap-2">
            <button className="h-9 flex-1 rounded-[10px] bg-primary text-[11px] font-medium text-primary-foreground">允许</button>
            <button className="h-9 flex-1 rounded-[10px] border border-border text-[11px] text-muted">拒绝</button>
          </div>
        </div>
        <div className="rounded-[12px] border border-border px-3 py-2 text-[12px]">
          <p className="flex items-center gap-1.5 font-medium"><span className="icon-[lucide--message-circle-question] size-3.5 text-primary" />测试失败要不要自动修？</p>
          <div className="mt-2 flex gap-1.5 text-[11px]">
            <span className="rounded-full border border-border px-2 py-1">先修</span>
            <span className="rounded-full border border-border px-2 py-1">只报告</span>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="flex items-end gap-2 rounded-[14px] border border-border bg-input px-2 py-1.5">
          <textarea rows={1} placeholder="发消息，或按住说话…" aria-label="输入" className="max-h-20 min-h-8 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 outline-none placeholder:text-faint" />
          <button className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground"><span className="icon-[lucide--arrow-up] size-4" /></button>
        </div>
        <p className="mt-1 text-center text-[10px] text-faint">运行中 · 消息会排队，或点「插入本轮」</p>
      </div>
    </div>
  );
}
