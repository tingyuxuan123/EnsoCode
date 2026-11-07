import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { RunningMark } from "./Eaves";
import { Sheet } from "./Sheet";
import { TopBar } from "./TopBar";
import { Prose, Steps, TurnHead, UserBubble } from "./Turn";

/**
 * 目标：会话顶上一条目标条，点开是这张面板。目标在，Agent 每轮结束会自己接着推进，
 * 直到达成、卡住或你暂停。`paused` 时它停在当前轮结束，按「继续」接着跑。
 */
export function GoalView({ paused = false }: { paused?: boolean }) {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/home"
				title="Windows 版 CI 签名失败排查"
				detail="Eaves · Claude Opus 5.5 · 高"
				menu
			/>
			<Link
				to={paused ? "/goal-paused" : "/goal"}
				className="glass mx-4 mt-1 flex h-11 items-center gap-2 rounded-full px-4 text-[14px]"
			>
				<span className={`${paused ? "icon-[lucide--pause] text-dim" : "icon-[lucide--target] text-blue"} size-4`} />
				<span className="min-w-0 flex-1 truncate font-medium">windows-v0.9.5 CI 通过</span>
				<span className="shrink-0 text-dim">{paused ? "已暂停" : "第 4 轮"}</span>
			</Link>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-4">
				<UserBubble>windows-v0.9.5 的 CI 一直签名失败，修到通过为止。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead
						time="6 分钟前"
						live={paused ? undefined : "第 4 轮"}
					/>
					<Steps>已完成 11 步 · 看了 3 次 CI 日志</Steps>
					<Prose>
						<p>第 3 轮的失败换了原因：证书能导入了，但 signtool 报时间戳服务器超时。</p>
					</Prose>
				</article>
			</div>
			<Sheet
				backTo="/board"
				title="目标"
				aside={
					paused ? (
						<span className="flex items-center gap-1.5 rounded-full bg-card2 px-3 py-1 text-[13px] leading-[18px] font-medium text-ink2">
							<span className="icon-[lucide--pause] size-3.5" />
							已暂停
						</span>
					) : (
						<span className="flex items-center gap-1.5 rounded-full bg-blue/10 px-3 py-1 text-[13px] leading-[18px] font-medium text-blue">
							<RunningMark size={14} />
							进行中
						</span>
					)
				}
			>
				<div className="px-6">
					<p className="text-[22px] leading-[30px] font-semibold">windows-v0.9.5 的 CI 全部通过，并自动公开为 Latest</p>
					<div className="mt-3 flex gap-5 text-[13px] leading-[18px] text-dim">
						<span>已自动推进 4 轮</span>
						<span>开始于 13:12</span>
						<span>{paused ? "14:20 暂停" : "用时 56 分钟"}</span>
					</div>
				</div>
				<div className="mx-3 mt-4 rounded-[20px] bg-card px-4 py-3.5">
					<div className="text-[12px] leading-4 font-medium text-dim">{paused ? "暂停时它的判断" : "它现在的判断"}</div>
					<p className="mt-1.5 text-[15px] leading-[22px]">
						时间戳服务器在 CI 上偶发超时。准备改成带重试的 RFC 3161 服务器，再推一次 tag 验证。
					</p>
					{paused && (
						<p className="mt-2 text-[13px] leading-[18px] text-dim">暂停期间它不会自己推进；你发的消息照常处理。</p>
					)}
				</div>
				<div className="mt-5 flex gap-2.5 px-4">
					{paused ? (
						<Link
							to="/goal"
							className="glass-ink flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium"
						>
							<span className="icon-[lucide--play] size-5" />
							继续
						</Link>
					) : (
						<Link
							to="/goal-paused"
							className="glass flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium"
						>
							<span className="icon-[lucide--pause] size-5" />
							暂停
						</Link>
					)}
					<button className="glass flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium">
						<span className="icon-[lucide--pencil] size-5" />
						改目标
					</button>
				</div>
				<button className="mt-2 w-full py-3 text-[15px] leading-5 font-medium text-red">清除目标</button>
			</Sheet>
		</div>
	);
}
