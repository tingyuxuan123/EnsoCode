export const frame = { width: 402, height: 874, radius: 62, title: "Bot 聊天列表" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { ChatListRow } from "../components/BotRows";
import { LinkPill } from "../components/LinkPill";
import { TopBar } from "../components/TopBar";

// 就是一张聊天列表：人和群在同一张表里，谁最后说话谁在上面。
// 第二行是最后一句；Bot 之间的转达只在句首加一个「来自 X」，不另开一屏。
export default function Bot() {
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
			>
				<LinkPill
					label="书房"
					compact
				/>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1 pb-24">
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="林经理"
						role="项目经理"
						preview="都回来了。部署没问题；设计稿点开产物看。"
						time="17:05"
						dot="waiting"
					/>
				</Link>
				<Link
					to="/group"
					className="block"
				>
					<ChatListRow
						name="EnsoCode 优化讨论"
						badge="群聊"
						stacked={["林经理", "阿全", "小设", "小测"]}
						preview="林经理：网页已上 relay.yfdl.site，公网入口正常。"
						time="16:10"
						dot="waiting"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="阿全"
						role="全栈"
						via="林经理"
						preview="补验 #6 的隔离远程历史加载"
						time="昨天"
						dot="running"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="小设"
						role="设计"
						via="林经理"
						preview="出 PWA 第一版视觉"
						time="昨天"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="小测"
						role="测试"
						preview="回归报告 · 第 42 周已交，全绿。"
						time="昨天"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="小测-gpt"
						role="测试"
						preview="刚跑完一轮，没有新回归。"
						time="昨天"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="黄呆呆"
						role="全栈"
						preview="补了一个空指针，已提交。"
						time="2 天前"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="小雪"
						role="全栈"
						preview="空闲 20 分钟，随时可以派活。"
						time="3 天前"
					/>
				</Link>
				<Link
					to="/bot-dm"
					className="block"
				>
					<ChatListRow
						name="老运"
						role="运维"
						preview="线上巡检正常，没有告警。"
						time="3 天前"
					/>
				</Link>
			</div>
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-page via-page/85 to-transparent" />
			<div className="absolute right-4 bottom-8 flex items-center gap-3">
				<Link
					to="/bot-comms"
					aria-label="通信空间"
					className="glass flex size-14 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--waypoints] size-6" />
				</Link>
				<Link
					to="/bot-new"
					className="glass-ink flex h-14 items-center gap-2 rounded-full px-5 text-[15px] font-medium"
				>
					<span className="icon-[lucide--message-square-plus] size-5" />
					新聊天
				</Link>
			</div>
		</div>
	);
}
