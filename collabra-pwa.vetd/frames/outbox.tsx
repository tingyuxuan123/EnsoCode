export const frame = { width: 402, height: 874, radius: 62, title: "离线待发" };

import { StatusBar } from "@vetta/ios";
import { MemberAvatar } from "../components/Brand";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { UserBubble } from "../components/Turn";

// 离线发件箱：发出去但没送到。待发送/发送中/失败三种状态，失败的才给重试和丢弃。
export default function Outbox() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/bot"
				title="林经理"
				detail="桌面端离线 · 3 条待发"
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<UserBubble>把 #6 的部署验一下。</UserBubble>
				<article className="flex flex-col gap-2 pb-5">
					<div className="flex items-center gap-2">
						<MemberAvatar
							name="林经理"
							size={26}
						/>
						<span className="text-[15px] leading-5 font-semibold">林经理</span>
						<div className="flex-1" />
						<span className="text-[11px] leading-4 text-faint tabular-nums">17:05</span>
					</div>
					<p className="text-[15px] leading-6">好，阿全去验了，回来我一起说。</p>
				</article>
			</div>
			<div className="shrink-0 px-3">
				<p className="pb-1.5 text-[11px] leading-4 text-dim">连上后会按原顺序自动重发</p>
				<div className="flex flex-col gap-1.5 pb-2">
					<div className="flex items-center gap-2 rounded-[14px] bg-card px-3 py-2.5">
						<span className="min-w-0 flex-1 truncate text-[13px] leading-[18px]">顺便看下缓存命中</span>
						<span className="shrink-0 text-[11px] leading-4 text-dim">待发送</span>
						<span className="icon-[lucide--x] size-3.5 shrink-0 text-faint" />
					</div>
					<div className="flex items-center gap-2 rounded-[14px] bg-card px-3 py-2.5">
						<span className="min-w-0 flex-1 truncate text-[13px] leading-[18px]">
							[2 张图片]
						</span>
						<span className="shrink-0 text-[11px] leading-4 text-dim">发送中…</span>
					</div>
					<div className="flex items-center gap-2 rounded-[14px] bg-red/5 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(220_38_38/0.25)]">
						<span className="min-w-0 flex-1 truncate text-[13px] leading-[18px]">
							再补一个 e2e
						</span>
						<span className="shrink-0 text-[11px] leading-4 text-red">发送失败</span>
						<span className="shrink-0 text-[12px] leading-4 font-medium text-ink2">重试</span>
						<span className="icon-[lucide--x] size-3.5 shrink-0 text-faint" />
					</div>
				</div>
			</div>
			<Composer placeholder="离线，仍可继续写…" />
		</div>
	);
}
