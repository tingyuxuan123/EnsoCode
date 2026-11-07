export const frame = { width: 412, height: 915, title: "消息队列" };

import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { CoworkerTabs } from "../components/CoworkerTabs";
import { TopBar } from "../components/TopBar";
import { Code, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

const queued = [
	{ id: "q1", text: "审查员卡住超过 5 分钟就把那一格标成黄色。", open: true },
	{ id: "q2", text: "完成后顺手把 workflowPanel 的快照测试更新一下。" },
	{ id: "q3", text: "最后跑一遍 pnpm typecheck && pnpm lint，别提交。", image: false },
];

/**
 * 运行中继续说话：消息不打断当前这一轮，排进队列，轮次结束后依次发出。
 * 每条都能改、删，或者打断当前轮立刻发。发送键换成停止键。
 */
export default function Queue() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/home"
				title="工作流面板显示运行进度"
				detail="Eaves · Claude Opus 5.5 · 高"
				menu
			/>
			<CoworkerTabs background="2 子代理 · 2 后台" />
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<UserBubble>给工作流面板加上运行进度：每个审查员一格，完成打勾。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead
						time="2 分钟前"
						live="正在运行测试"
					/>
					<Steps>已完成 6 步 · 改了 2 个文件</Steps>
					<Prose>
						<p>
							进度条已经接上 <Code>workflow/progress</Code> 事件，每个审查员一格，完成后变成实心。现在跑一下相关测试。
						</p>
					</Prose>
					<Steps live>bash · pnpm vitest run workflowPanel</Steps>
				</article>
			</div>
			<section className="mx-3 overflow-hidden rounded-[22px] bg-card">
				<header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
					<span className="icon-[lucide--list-ordered] size-4 text-ink2" />
					<h2 className="text-[15px] leading-5 font-semibold">排队中 · 3 条</h2>
					<span className="ml-auto text-[12px] leading-4 text-dim">本轮结束后依次发送</span>
				</header>
				{queued.map((q, i) => (
					<div
						key={q.id}
						className={q.open ? "bg-card2/60" : ""}
					>
						<div className="flex items-start gap-3 px-4 py-2.5">
							<span className="w-4 shrink-0 text-right text-[13px] leading-5 text-faint tabular-nums">{i + 1}</span>
							<p className={`min-w-0 flex-1 text-[14px] leading-5 ${q.open ? "" : "truncate"}`}>{q.text}</p>
							{!q.open && <span className="icon-[mdi--dots-vertical] size-5 shrink-0 text-ink2" />}
						</div>
						{q.open && (
							<div className="flex gap-2 px-4 pb-3 pl-11">
								<button className="flex h-8 items-center gap-1.5 rounded-full bg-pill px-3 text-[13px] font-medium text-pill-ink">
									<span className="icon-[lucide--zap] size-3.5" />
									打断并发送
								</button>
								<button className="flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-medium">
									<span className="icon-[lucide--pencil] size-3.5" />
									编辑
								</button>
								<button className="flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-medium text-red">
									<span className="icon-[lucide--trash-2] size-3.5" />
									删除
								</button>
							</div>
						)}
					</div>
				))}
			</section>
			<Composer
				placeholder="继续说，会排进队列"
				running
				meta={{ mode: "自动接受编辑", context: 62, tokens: "1.25M", cache: "81%" }}
			/>
		</div>
	);
}
