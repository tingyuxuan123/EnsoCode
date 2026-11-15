export const frame = { width: 402, height: 874, radius: 62, title: "Agent 提问" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";
import { Code, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

const options = ["全量 pnpm test", "只跑 sessionReducer", "只跑 e2e"];

// Agent 提问：问题和选项顶替输入框；选项之外也能直接写回答，倒计时一直在右上角。
export default function Ask() {
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
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<UserBubble>恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead time="5 分钟前" />
					<Steps>已完成 5 步 · 读了 4 个文件，改了 2 个</Steps>
					<Prose>
						<p>
							修好了，测试也补上了。全量测试要跑 3 分半，只跑 <Code>sessionReducer</Code> 大概 20 秒。
						</p>
						<p>你想先跑哪一组？</p>
					</Prose>
				</article>
			</div>
			<section className="glass relative mx-3 mb-7 rounded-[26px] p-4">
				<div className="flex items-center gap-2">
					<span className="icon-[lucide--circle-help] size-[18px] animate-pulse text-yellow" />
					<h2 className="flex-1 text-[15px] leading-5 font-semibold">它在问你</h2>
					<span className="flex items-center gap-1 text-[12px] leading-4 text-dim tabular-nums">
						<span className="icon-[lucide--timer] size-3.5" />
						4:52 后视为未回答
					</span>
				</div>
				<div className="mt-3 flex flex-col gap-2">
					{options.map((o, i) => (
						<div
							key={o}
							role="radio"
							aria-checked={i === 1}
							className={`flex items-center gap-3 rounded-[16px] bg-card px-4 py-3.5 ${
								i === 1
									? "shadow-[inset_0_0_0_2px_var(--color-ink)]"
									: "shadow-[inset_0_0_0_0.75px_var(--color-line)]"
							}`}
						>
							<span className="flex-1 text-[15px] leading-5 font-medium">{o}</span>
							{i === 1 ? (
								<span className="icon-[lucide--check] size-4" />
							) : (
								<span className="size-4 rounded-full border border-line" />
							)}
						</div>
					))}
				</div>
				<div className="mt-3 flex items-center gap-2">
					<div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-3xl border border-line bg-card pr-1.5 pl-4">
						<span className="min-w-0 flex-1 truncate text-[15px] text-dim">或者直接写你的回答</span>
						<span className="icon-[lucide--mic] size-5 shrink-0 text-ink" />
					</div>
					<button className="glass-ink flex h-12 shrink-0 items-center gap-1.5 rounded-full px-5 text-[15px] font-medium">
						回答
						<span className="icon-[lucide--arrow-up] size-[18px]" />
					</button>
				</div>
			</section>
		</div>
	);
}
