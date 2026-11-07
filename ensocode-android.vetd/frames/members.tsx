export const frame = { width: 412, height: 915, title: "成员" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { BotAvatar } from "../components/BotAvatar";
import { TopBar } from "../components/TopBar";
import { bots } from "../components/data";

const inbox = [
	{ key: "i1", bot: bots.lin, kind: "在问你", text: "安卓版 v1 先做第一档还是连第二档一起？" },
	{ key: "i2", bot: bots.yun, kind: "请求批准", text: "重启 relay 服务：systemctl restart enso-relay" },
];

const direct = [
	{ bot: bots.lin, text: "设计已派给小设，FCM 推送排在阿全那里。", time: "2 分钟" },
	{ bot: bots.she, text: "第一档的 8 个页面画好 5 个了。", time: "5 分钟" },
	{ bot: bots.ce, text: "回归跑完了：38 通过，2 失败。", time: "6 分钟" },
	{ bot: bots.quan, text: "等 Firebase 配置，推送先停在这里。", time: "12 分钟" },
	{ bot: bots.yun, text: "relay 内存占用回落到 180 MB。", time: "昨天" },
];

const state = { running: "运行中", queued: "排队中", idle: "" };

/** 成员（Bots）：最上面是要你处理的，然后是群聊，再是每位成员的单聊。 */
export default function Members() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/home"
				title="成员"
				detail="5 位成员 · 1 个群聊"
			/>
			<div className="min-h-0 flex-1 overflow-hidden pb-28">
				<h2 className="px-5 pt-2 pb-1.5 text-[15px] leading-5 font-semibold text-dim">收件箱</h2>
				{inbox.map((item) => (
					<Link
						key={item.key}
						to="/group"
						className="flex items-center gap-3 bg-yellow/[0.09] px-5 py-3 [&+&]:shadow-[inset_0_0.75px_0_var(--color-line)]"
					>
						<BotAvatar
							bot={item.bot}
							size={36}
						/>
						<div className="min-w-0 flex-1">
							<div className="text-[13px] leading-[18px] text-ink2">
								<span className="font-medium text-ink">{item.bot.name}</span> {item.kind}
							</div>
							<div className="truncate text-[15px] leading-5 font-medium">{item.text}</div>
						</div>
						<span className="icon-[mdi--help] size-4 shrink-0 animate-pulse text-yellow" />
					</Link>
				))}

				<h2 className="px-5 pt-6 pb-1.5 text-[15px] leading-5 font-semibold text-dim">群聊</h2>
				<Link
					to="/group"
					className="flex items-center gap-3 px-5 py-2.5"
				>
					<span className="relative size-11 shrink-0">
						<span className="absolute top-0 left-0">
							<BotAvatar
								bot={bots.lin}
								size={28}
								ring
							/>
						</span>
						<span className="absolute right-0 bottom-0">
							<BotAvatar
								bot={bots.she}
								size={28}
								ring
							/>
						</span>
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline gap-2">
							<span className="truncate text-[16px] leading-[22px] font-medium">Eaves 安卓版</span>
							<span className="ml-auto shrink-0 text-[12px] leading-4 text-dim">刚刚</span>
						</div>
						<div className="truncate text-[13px] leading-[18px] text-ink2">林经理：先派设计，小设接一下。</div>
					</div>
				</Link>

				<h2 className="px-5 pt-6 pb-1.5 text-[15px] leading-5 font-semibold text-dim">单聊</h2>
				{direct.map((d) => (
					<Link
						key={d.bot.id}
						to="/bot"
						className="flex items-center gap-3 px-5 py-2.5"
					>
						<BotAvatar
							bot={d.bot}
							size={44}
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline gap-2">
								<span className="text-[16px] leading-[22px] font-medium">{d.bot.name}</span>
								<span className="truncate text-[13px] leading-[18px] text-dim">{d.bot.title}</span>
								<span className="ml-auto shrink-0 text-[12px] leading-4 text-dim">{d.time}</span>
							</div>
							<div className="flex items-center gap-1.5 text-[13px] leading-[18px] text-ink2">
								{state[d.bot.status] && (
									<span className={`shrink-0 ${d.bot.status === "running" ? "text-blue" : "text-dim"}`}>{state[d.bot.status]}</span>
								)}
								<span className="truncate">{d.text}</span>
							</div>
						</div>
					</Link>
				))}
			</div>
			<div className="absolute right-4 bottom-8">
				<button className="glass flex h-14 items-center gap-2 rounded-full px-6 text-[15px] font-medium">
					<span className="icon-[lucide--plus] size-5" />
					新群聊
				</button>
			</div>
		</div>
	);
}
