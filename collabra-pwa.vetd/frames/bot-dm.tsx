export const frame = { width: 402, height: 874, radius: 62, title: "单聊 · 调度" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { FanOutRow, ReplyBrief, SegmentLead } from "../components/BotRows";
import { MemberAvatar } from "../components/Brand";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { UserBubble } from "../components/Turn";

// 单聊只跟一个人说话：他负责拆解和回话。派给谁、派了几个，压成一行；
// 各自的回复收成一张回执卡，主线程不被两个 Bot 同时刷屏。
export default function BotDm() {
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
				detail="项目经理 · 在管 4 个 Bot"
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
				<UserBubble>把 #6 的部署验一下；另外 PWA 重设计这周能不能出第一版？</UserBubble>
				<div className="flex flex-col gap-2 pb-2">
					<div className="flex items-center gap-2">
						<MemberAvatar
							name="林经理"
							size={26}
						/>
						<span className="text-[15px] leading-5 font-semibold">林经理</span>
						<div className="flex-1" />
						<span className="text-[11px] leading-4 text-faint tabular-nums">15:23</span>
					</div>
					<p className="text-[15px] leading-6">
						拆成两件事：部署让阿全验，设计让小设出第一版。今天给你回音。
					</p>
					<FanOutRow
						names={["阿全", "小设"]}
						label="发消息给 2 个 Bot"
					/>
				</div>
				<SegmentLead>6 条消息，与 2 个 Bot</SegmentLead>
				<div className="divide-line/60 overflow-hidden rounded-[18px] bg-card shadow-[0_0_0_0.75px_rgb(0_0_0/0.04)] divide-y">
					<ReplyBrief
						name="阿全"
						text="部署已验收，公网入口正常。"
					/>
					<ReplyBrief
						name="小设"
						text="第一版出了，在产物里。"
					/>
				</div>
				<div className="flex flex-col gap-2 pt-5">
					<div className="flex items-center gap-2">
						<MemberAvatar
							name="林经理"
							size={26}
						/>
						<span className="text-[15px] leading-5 font-semibold">林经理</span>
						<div className="flex-1" />
						<span className="text-[11px] leading-4 text-faint tabular-nums">17:05</span>
					</div>
					<p className="text-[15px] leading-6">
						都回来了。部署没问题；设计稿点开产物看，是黑白 + 玻璃那版。
					</p>
				</div>
			</div>
			<Composer placeholder="向 林经理 提问…" />
		</div>
	);
}
