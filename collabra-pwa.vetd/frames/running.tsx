export const frame = { width: 402, height: 874, radius: 62, title: "运行中" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Code, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 运行中：折叠步骤显示当前这一步，回复末尾有光标，下面一行告诉你排队的两条会怎么发。
export default function Running() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/sessions"
				title="恢复会话后时间线为空"
				detail="EnsoCode · Sonnet 4.6 · 思考 高"
				menu
				detailTo="/config"
			>
				<Link
					to="/artifacts"
					aria-label="会话菜单"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--ellipsis-vertical] size-6" />
				</Link>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<p className="pb-4 text-center text-[11px] leading-[14px] text-faint">今天 14:02</p>
				<UserBubble>恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead
						time="正在回复"
						live="跑测试 · 4:12"
					/>
					<Steps live>bash: pnpm test -- src/stores/sessions/reducer</Steps>
					<Prose>
						<p>
							修法是把重置放进回放的第一条事件，并把过期判定收窄到实时事件——只有带{" "}
							<Code>live</Code> 标记的事件才比对 <Code>lastSeq</Code>。
						</p>
						<p>
							正在跑回归，确认恢复后时间线条数与 jsonl 一致
							<span className="ml-0.5 inline-block h-[17px] w-[3px] translate-y-[3px] animate-pulse rounded-sm bg-ink" />
						</p>
					</Prose>
				</article>
			</div>
			<div className="shrink-0 px-3 pb-1">
				<div className="flex items-center gap-3 rounded-[18px] bg-card2 px-3.5 py-2.5">
					<span className="flex size-6 items-center justify-center rounded-full bg-card text-[11px] font-semibold text-ink2 tabular-nums">
						2
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-[14px] leading-[18px] font-medium">2 条排队</p>
						<p className="truncate text-[12px] leading-4 text-dim">
							「顺便看一下缓存命中」·「再补一个 e2e」
						</p>
					</div>
					<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
				</div>
			</div>
			<Composer
				running
				meta={{ context: 41, tokens: "13.1k", cache: "90%", speed: "38 t/s" }}
			/>
		</div>
	);
}
