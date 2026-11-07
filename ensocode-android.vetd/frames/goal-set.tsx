export const frame = { width: 412, height: 915, title: "设定目标" };

import { Sheet } from "../components/Sheet";
import Session from "./session";

const ideas = ["相关测试全部通过", "CI 变绿", "改完并提交，不推送"];

/** 设定目标（goal-set）：写一句「什么算完成」，它每轮结束自己对照着推进。 */
export default function GoalSet() {
	return (
		<div className="relative h-full overflow-hidden">
			<Session />
			<Sheet
				backTo="/session-menu"
				title="设定目标"
			>
				<p className="px-6 text-[14px] leading-5 text-ink2">写清楚什么算完成。它每轮结束会对照检查，没达成就自己接着做，直到达成、卡住或你暂停。</p>
				<div className="mx-3 mt-4 min-h-[120px] rounded-[20px] bg-card px-4 py-3.5 shadow-[inset_0_0_0_1.5px_var(--color-ink)]">
					<p className="text-[17px] leading-[26px]">
						会话恢复的回归全部通过，修复提交到 fix/restore-timeline 分支
						<span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-ink" />
					</p>
				</div>
				<div className="mt-3 flex flex-wrap gap-2 px-4">
					{ideas.map((t) => (
						<button
							key={t}
							className="h-9 rounded-full bg-card2 px-3.5 text-[14px] text-ink2"
						>
							{t}
						</button>
					))}
				</div>
				<div className="mt-5 flex items-center gap-3 px-4">
					<span className="flex flex-1 items-center gap-1.5 text-[13px] leading-[18px] text-dim">
						<span className="icon-[lucide--shield-check] size-4" />
						审批照常：全程审批
					</span>
					<button className="glass-ink flex h-[52px] items-center gap-2 rounded-full px-7 text-[15px] font-medium">
						<span className="icon-[lucide--target] size-5" />
						开始
					</button>
				</div>
			</Sheet>
		</div>
	);
}
