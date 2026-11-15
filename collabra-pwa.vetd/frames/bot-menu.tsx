export const frame = { width: 402, height: 874, radius: 62, title: "会话菜单" };

import { StatusBar } from "@vetta/ios";
import { SegmentLead } from "../components/BotRows";
import { MemberAvatar } from "../components/Brand";
import { Sheet } from "../components/Sheet";
import { TopBar } from "../components/TopBar";
import { UserBubble } from "../components/Turn";

const items = [
	{
		icon: "icon-[lucide--plus-circle]",
		label: "开新会话",
		hint: "清掉这段上下文，从这个群重新开始",
		danger: true,
	},
	{
		icon: "icon-[lucide--git-branch]",
		label: "新线程",
		hint: "在这段对话里另起一条线索",
		danger: false,
	},
	{
		icon: "icon-[lucide--file-stack]",
		label: "产物",
		hint: "本轮 3 个文件，可以下载",
		danger: false,
	},
	{
		icon: "icon-[lucide--waypoints]",
		label: "通信空间",
		hint: "Bot 之间的来去，只读",
		danger: false,
	},
];

// 会话里的 ⋯：只放会话级动作。开新会话是破坏性的，行内就写明"清掉上下文"，
// 点下去还要再确认一次；找人单聊、建群这类动作留在新聊天面板里。
export default function BotMenu() {
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
				title="会话"
				aside={
					<span className="text-[12px] leading-4 text-dim tabular-nums">4 名成员</span>
				}
			>
				<div className="px-5">
					{items.map((it, i) => (
						<button
							key={it.label}
							className={`flex w-full items-center gap-3 py-3 text-left ${
								i > 0 ? "border-line/60 border-t" : ""
							}`}
						>
							<span
								className={`flex w-6 shrink-0 items-center justify-center ${
									it.danger ? "text-red" : "text-ink"
								}`}
							>
								<span className={`${it.icon} size-[18px]`} />
							</span>
							<span className="min-w-0 flex-1">
								<span
									className={`block text-[15px] leading-5 font-medium ${it.danger ? "text-red" : ""}`}
								>
									{it.label}
								</span>
								<span className="block truncate text-[12px] leading-4 text-dim">{it.hint}</span>
							</span>
							<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
						</button>
					))}
				</div>
				<div className="px-5 pt-2">
					<button className="h-12 w-full rounded-full bg-card2 text-[15px] font-medium text-ink2">
						取消
					</button>
				</div>
			</Sheet>
		</div>
	);
}
