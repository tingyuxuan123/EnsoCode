export const frame = { width: 390, height: 844, title: "手机 · 会话设置（底部弹层）" };

import { Link } from 'react-router';

/** 会话配置底部弹层（SessionConfigSheet）：模型、审批档位、推理与思考档位、用量；只读设备时禁用 */
export default function PhoneConfig() {
  return (
    <div className="relative flex h-full flex-col bg-panel/40">
      <div className="flex h-12 items-center gap-2 border-b border-line bg-surface px-3 text-[12px]">
        <Link to="/phone-sessions" className="text-muted">会话</Link>
        <span className="text-border">/</span>
        <span className="text-surface-foreground">设置</span>
      </div>
      <div className="min-h-0 flex-1" />
      <div className="rounded-t-[16px] border-t border-line bg-surface px-4 pb-5 pt-2">
        <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border" />
        <div className="flex items-center"><p className="text-[15px] font-semibold">会话设置</p><Link to="/phone-chat" className="ml-auto text-[12px] text-primary">完成</Link></div>
        <div className="mt-3 space-y-2 text-[12px]">
          <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-16 shrink-0 text-muted">模型</span><span className="min-w-0 flex-1 truncate">Claude Sonnet 4.5</span><span className="icon-[lucide--chevron-down] size-3.5 text-faint" /></div>
          <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-16 shrink-0 text-muted">审批档位</span><span className="min-w-0 flex-1 truncate">自动接受编辑</span><span className="icon-[lucide--chevron-down] size-3.5 text-faint" /></div>
          <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-16 shrink-0 text-muted">推理</span><span className="min-w-0 flex-1 text-muted">思考档位 中</span><span className="flex h-[18px] w-8 items-center justify-end rounded-full bg-primary px-[3px]"><span className="size-3 rounded-full bg-white" /></span></div>
          <div className="rounded-control bg-panel px-3 py-2 text-[11px] leading-5">
            <p className="text-muted">本次用量</p>
            <p className="mt-0.5 tabular-nums">↑ 48.2K ↓ 6.1K · 缓存 82% · 4 轮 · 24m</p>
          </div>
          <div className="rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[11px] leading-5">
            这台设备是只读权限：可以查看与输入，但不能审批或停止会话。可在桌面「设置 → 设备」改成可操作。
          </div>
        </div>
      </div>
    </div>
  );
}
