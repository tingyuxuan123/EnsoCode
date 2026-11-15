export const frame = { width: 402, height: 874, radius: 62, title: "群聊 · 降噪" };

import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { ActivityRow, SegmentLead } from "../components/BotRows";
import { MemberAvatar } from "../components/Brand";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { UserBubble } from "../components/Turn";

function Say({
	name,
	time,
	children,
}: {
	name: string;
	time: string;
	children: ReactNode;
}) {
	return (
		<article className="flex flex-col gap-2 pb-5">
			<div className="flex items-center gap-2">
				<MemberAvatar
					name={name}
					size={26}
				/>
				<span className="text-[15px] leading-5 font-semibold">{name}</span>
				<div className="flex-1" />
				<span className="text-[11px] leading-4 text-faint tabular-nums">{time}</span>
			</div>
			<div className="flex flex-col gap-2.5 text-[15px] leading-6">{children}</div>
		</article>
	);
}

// 同一个群、同一批事实，但每个人只留一段人话。开工、交付、委派、验收全部收进
// 「7 步 · 委派 1 次」这一行，点开才是过程。
export default function Group() {
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
			>
				<Link
					to="/bot-menu"
					aria-label="会话菜单"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--ellipsis-vertical] size-6" />
				</Link>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<SegmentLead>今天 15:23</SegmentLead>
				<UserBubble>帮我部署上去看看，124.222.38.18</UserBubble>
				<Say
					name="阿全"
					time="15:41"
				>
					<p>部署完成，就等你实机验收。</p>
					<ActivityRow
						summary="7 步 · 委派 1 次"
						state="已验收"
					/>
				</Say>
				<Say
					name="林经理"
					time="16:10"
				>
					<p>
						网页已上 relay.yfdl.site，公网入口和健康检查都正常。别清浏览器数据——会丢配对和离线队列。
					</p>
				</Say>
				<Say
					name="小测"
					time="16:24"
				>
					<p>回归我先不跑，等这次部署稳定了再说。</p>
				</Say>
				<SegmentLead>昨天 13:40</SegmentLead>
				<Say
					name="林经理"
					time="13:40"
				>
					<p>PWA 重设计第一版放产物里了，黑白 + 玻璃那套。</p>
				</Say>
			</div>
			<div className="shrink-0 px-3">
				<p className="pb-0.5 text-center text-[11px] leading-4 text-faint">
					不 @ 时，会挑最合适的成员回复
				</p>
			</div>
			<Composer placeholder="@ 成员，或直接说…" />
		</div>
	);
}
