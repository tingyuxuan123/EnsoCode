export const frame = { width: 402, height: 874, radius: 62, title: "新聊天" };

import { StatusBar } from "@vetta/ios";
import { ChatListRow, RoleChip } from "../components/BotRows";
import { MemberAvatar } from "../components/Brand";
import { Sheet, SheetLabel } from "../components/Sheet";
import { TopBar } from "../components/TopBar";
import { members } from "../components/data";

// 「新聊天」只有两条路：跟某个成员单聊（bot-direct-open），或者拉几个人建群
// （bot-group-create）。开新会话/新线程属于会话内的动作，不放这里。
export default function BotNew() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/sessions"
				title="Bot"
				detail="4 人在线 · 3 条待处理"
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<ChatListRow
					name="林经理"
					role="项目经理"
					preview="都回来了。部署没问题；设计稿点开产物看。"
					time="17:05"
					dot="waiting"
				/>
				<ChatListRow
					name="EnsoCode 优化讨论"
					badge="群聊"
					stacked={["林经理", "阿全", "小设", "小测"]}
					preview="林经理：网页已上 relay.yfdl.site，公网入口正常。"
					time="16:10"
					dot="waiting"
				/>
				<ChatListRow
					name="阿全"
					role="全栈"
					via="林经理"
					preview="补验 #6 的隔离远程历史加载"
					time="昨天"
					dot="running"
				/>
			</div>
			<Sheet
				backTo="/bot"
				title="新聊天"
				aside={
					<span className="text-[12px] leading-4 text-dim tabular-nums">4 人在线</span>
				}
			>
				<div className="px-5">
					<button className="flex w-full items-center gap-3 rounded-[16px] bg-card px-3.5 py-3 text-left shadow-[0_0_0_0.75px_rgb(0_0_0/0.05)]">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card2 text-ink">
							<span className="icon-[lucide--users-round] size-5" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-[15px] leading-5 font-medium">新建群聊</span>
							<span className="block text-[12px] leading-4 text-dim">拉几个成员进来，起个名字</span>
						</span>
						<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
					</button>
				</div>
				<SheetLabel>找人单聊</SheetLabel>
				<div className="px-5">
					{members.map((m) => (
						<button
							key={m.name}
							className="flex w-full items-center gap-3 py-2.5 text-left"
						>
							<MemberAvatar
								name={m.name}
								size={38}
								online={m.status !== "idle"}
							/>
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-1.5">
									<span className="truncate text-[15px] leading-[21px] font-medium">{m.name}</span>
									<RoleChip>{m.role}</RoleChip>
								</span>
								<span className="block truncate text-[12px] leading-4 text-dim">{m.note}</span>
							</span>
							<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
						</button>
					))}
				</div>
				<p className="px-6 pt-2 text-[11px] leading-4 text-faint">
					选人会直接开一个跟他的对话；群里可以用 @ 指定谁来做。
				</p>
			</Sheet>
		</div>
	);
}
