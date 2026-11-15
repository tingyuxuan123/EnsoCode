export const frame = { width: 402, height: 874, radius: 62, title: "通信空间" };

import { StatusBar } from "@vetta/ios";
import { MemberAvatar } from "../components/Brand";
import { TopBar } from "../components/TopBar";

const records = [
	{
		from: "林经理",
		to: "阿全",
		task: "补验 #6 的隔离远程历史加载",
		state: "已完成 · 44 分钟",
		result: "都跑完了，证据 3 个文件，没进版本库。",
		live: false,
	},
	{
		from: "林经理",
		to: "小设",
		task: "出 PWA 第一版视觉",
		state: "已完成 · 1 小时",
		result: "4 屏，黑白底 + 玻璃浮层。",
		live: false,
	},
	{
		from: "林经理",
		to: "小测",
		task: "跑 #6 的回归",
		state: "进行中 · 12 分钟",
		result: "在跑，别关电脑。",
		live: true,
	},
	{
		from: "林经理",
		to: "阿全",
		task: "整理 #5 的验收记录",
		state: "已完成 · 2 小时",
		result: "没有残留问题，归档了。",
		live: false,
	},
];

// 通信空间：Bot 之间的来去，只读。给的是「谁让谁做什么、结果如何」，
// 原始指令和本机路径留在桌面端，不下发到手机。
export default function BotComms() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/bot-dm"
				title="通信空间"
				detail="只读 · 3 条"
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<p className="pb-3 text-[12px] leading-4 text-dim">
					这是 Bot 之间的来去。只给你看谁让谁做了什么、结果如何；原始指令和本机路径留在电脑上。
				</p>
				<div className="flex flex-col gap-2.5">
					{records.map((r) => (
						<div
							key={r.task}
							className="rounded-[18px] bg-card p-3.5"
						>
							<div className="flex items-center gap-1.5 text-[11px] leading-4 text-faint">
								<MemberAvatar
									name={r.from}
									size={18}
								/>
								<span className="text-ink2">{r.from}</span>
								<span className="icon-[lucide--arrow-right] size-3" />
								<MemberAvatar
									name={r.to}
									size={18}
								/>
								<span className="text-ink2">{r.to}</span>
								<div className="flex-1" />
								{r.live && <span className="size-1.5 rounded-full bg-blue" />}
								<span className="tabular-nums">{r.state}</span>
							</div>
							<p className="mt-2 text-[14px] leading-5 font-medium">{r.task}</p>
							<p className="mt-1 text-[12px] leading-[18px] text-dim">{r.result}</p>
						</div>
					))}
				</div>
			</div>
			<div className="shrink-0 px-5 pt-2 pb-10">
				<p className="text-[11px] leading-4 text-faint">
					只读。要改指令，回单聊跟发起人说。
				</p>
			</div>
		</div>
	);
}
