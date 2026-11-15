export const frame = { width: 402, height: 874, radius: 62, title: "线程切换" };

import { StatusBar } from "@vetta/ios";
import { SegmentLead } from "../components/BotRows";
import { MemberAvatar } from "../components/Brand";
import { Sheet } from "../components/Sheet";
import { TopBar } from "../components/TopBar";
import { UserBubble } from "../components/Turn";

const threads = [
	{ name: "主线程", count: "4 条", time: "今天 16:10", current: true },
	{ name: "部署验收", count: "2 条", time: "昨天 15:20", current: false },
	{ name: "设计评审", count: "1 条", time: "昨天 11:04", current: false },
];

// 线程：一个群里另起几条线索，避免混着聊。列表只做切换和新建，不改内容。
export default function Threads() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/bot"
				title="EnsoCode 优化讨论"
				detail="4 名成员 · 群主 林经理"
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<SegmentLead>今天 15:23</SegmentLead>
				<UserBubble>帮我部署上去看看，124.222.38.18</UserBubble>
				<article className="flex flex-col gap-2 pb-5">
					<div className="flex items-center gap-2">
						<MemberAvatar
							name="阿全"
							size={26}
						/>
						<span className="text-[15px] leading-5 font-semibold">阿全</span>
						<div className="flex-1" />
						<span className="text-[11px] leading-4 text-faint tabular-nums">15:41</span>
					</div>
					<p className="text-[15px] leading-6">部署完成，就等你实机验收。</p>
				</article>
			</div>
			<Sheet
				backTo="/group"
				title="线程"
				aside={
					<span className="text-[12px] leading-4 text-dim tabular-nums">3 个</span>
				}
			>
				<div className="px-5">
					{threads.map((t) => (
						<button
							key={t.name}
							className="flex w-full items-center gap-3 py-3 text-left"
						>
							<span className="flex w-5 shrink-0 items-center justify-center">
								{t.current && <span className="icon-[lucide--check] size-4" />}
							</span>
							<span className="min-w-0 flex-1">
								<span
									className={`block truncate text-[15px] leading-5 ${
										t.current ? "font-semibold" : "font-medium text-ink2"
									}`}
								>
									{t.name}
								</span>
								<span className="block text-[12px] leading-4 text-dim tabular-nums">
									{t.count} · {t.time}
								</span>
							</span>
						</button>
					))}
					<button className="mt-1 flex w-full items-center gap-3 rounded-[16px] bg-card px-3.5 py-3 text-left">
						<span className="flex w-5 shrink-0 items-center justify-center">
							<span className="icon-[lucide--plus] size-4" />
						</span>
						<span className="min-w-0 flex-1 text-[15px] leading-5 font-medium">新建线程</span>
						<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
					</button>
				</div>
				<p className="px-6 pt-3 text-[11px] leading-4 text-faint">
					离线时只能看，不能切换或新建。
				</p>
			</Sheet>
		</div>
	);
}
