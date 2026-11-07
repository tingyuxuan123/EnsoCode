export const frame = { width: 412, height: 915, title: "群聊" };

import type { ReactNode } from "react";
import { StatusBar } from "@vetta/ios";
import { BotAvatar } from "../components/BotAvatar";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { UserBubble } from "../components/Turn";
import { type Bot, bots } from "../components/data";

function BotLine({ bot, time, children }: { bot: Bot; time: string; children: ReactNode }) {
	return (
		<div className="flex gap-2.5 pb-4">
			<BotAvatar
				bot={bot}
				size={30}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="text-[14px] leading-5 font-semibold">{bot.name}</span>
					<span className="text-[12px] leading-4 text-dim">{time}</span>
				</div>
				<div className="mt-0.5 text-[15px] leading-6">{children}</div>
			</div>
		</div>
	);
}

/** 委派卡：谁派给谁、做什么、现在到哪了（PairGroupEntry delegation + progress）。 */
function Delegation({
	from,
	to,
	task,
	state,
	tone,
	note,
}: {
	from: Bot;
	to: Bot;
	task: string;
	state: string;
	tone: "blue" | "yellow" | "dim";
	note?: string;
}) {
	const color = { blue: "text-blue bg-blue/10", yellow: "text-yellow-ink bg-yellow/15", dim: "text-dim bg-card2" }[tone];
	return (
		<div className="mb-2.5 ml-10 rounded-[18px] bg-card px-4 py-3">
			<div className="flex items-center gap-1.5 text-[12px] leading-4 text-dim">
				<span>{from.name}</span>
				<span className="icon-[lucide--arrow-right] size-3" />
				<BotAvatar
					bot={to}
					size={16}
				/>
				<span className="font-medium text-ink2">{to.name}</span>
				<span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] leading-[14px] font-medium ${color}`}>{state}</span>
			</div>
			<p className="mt-1.5 text-[15px] leading-5 font-medium">{task}</p>
			{note && <p className="mt-1 text-[13px] leading-[18px] text-ink2">{note}</p>}
		</div>
	);
}

/** 群聊：你 @ 主持人，主持人拆任务派给成员，委派和进度直接出现在时间线里。 */
export default function Group() {
	const members = [bots.lin, bots.she, bots.quan, bots.ce];
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/members"
				title="EnsoCode 安卓版"
				detail="线程：v1 规划 · 林经理主持"
				menu
			>
				<div className="flex -space-x-2">
					{members.map((m) => (
						<BotAvatar
							key={m.id}
							bot={m}
							size={26}
							ring
						/>
					))}
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<p className="pb-4 text-center text-[11px] leading-[14px] text-faint">今天 13:40</p>
				<UserBubble>@林经理 把安卓版 v1 拆一下，设计稿先出。</UserBubble>
				<BotLine
					bot={bots.lin}
					time="13:41"
				>
					收到。拆成三块：设计稿给小设，配对和推送给阿全，回归给小测。先派设计。
				</BotLine>
				<Delegation
					from={bots.lin}
					to={bots.she}
					task="补齐第一档缺的 8 个页面"
					state="进行中"
					tone="blue"
					note="已完成 5 / 8 · 正在画通知页"
				/>
				<Delegation
					from={bots.lin}
					to={bots.quan}
					task="安卓原生推送接 FCM"
					state="卡住了"
					tone="yellow"
					note="需要 Firebase 项目的 google-services.json"
				/>
				<Delegation
					from={bots.lin}
					to={bots.ce}
					task="会话恢复相关回归"
					state="已交付"
					tone="dim"
				/>
				<div className="pt-2">
					<BotLine
						bot={bots.lin}
						time="刚刚"
					>
						阿全卡在 Firebase 配置上，这个得你在 Firebase 控制台建好项目，把 json 发到群里。
					</BotLine>
				</div>
			</div>
			<Composer placeholder="@ 成员，或直接说" />
		</div>
	);
}
