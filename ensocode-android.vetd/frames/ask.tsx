export const frame = { width: 412, height: 915, title: "Agent 提问" };

import { StatusBar } from "@vetta/ios";
import light from "../assets/workspace-current.png";
import dark from "../assets/workflows-current.png";
import { TopBar } from "../components/TopBar";
import { Code, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

const shots = [
	{ src: light, title: "浅色", file: "workspace-current.png" },
	{ src: dark, title: "深色", file: "workflows-current.png" },
];

/**
 * Agent 提问（ask_user）：问题和选项顶替输入框；选项之外也能直接写回答。
 * 截止时间到了按未回答处理，所以倒计时一直在右上角。
 */
export default function Ask() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/home"
				title="首页 Hero 用哪张截图"
				detail="ensocode-site · Claude Opus 5.5 · 高"
				menu
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<UserBubble>把官网首页的 Hero 换成新版工作区的截图。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead time="4 分钟前" />
					<Steps>已完成 3 步 · 读了 README 和 2 张截图</Steps>
					<Prose>
						<p>
							仓库里有两张新截图可以用：浅色的 <Code>workspace-current.png</Code> 是项目导航加新任务，深色的那张展开了并行审查工作流。
						</p>
						<p>官网 Hero 是白底，我倾向浅色，但想先确认一下。</p>
					</Prose>
				</article>
			</div>
			<section className="glass relative mx-3 mb-7 rounded-[26px] p-4">
				<div className="flex items-center gap-2">
					<span className="icon-[mdi--help] size-[18px] animate-pulse text-yellow" />
					<h2 className="flex-1 text-[15px] leading-5 font-semibold">它在问你</h2>
					<span className="flex items-center gap-1 text-[12px] leading-4 text-dim tabular-nums">
						<span className="icon-[lucide--timer] size-3.5" />
						4:52 后视为未回答
					</span>
				</div>
				<p className="mt-2.5 text-[17px] leading-6 font-medium">Hero 用浅色还是深色截图？</p>
				<div className="mt-3 grid grid-cols-2 gap-2.5">
					{shots.map((s, i) => (
						<div
							key={s.file}
							role="radio"
							aria-checked={i === 0}
							className={`overflow-hidden rounded-[18px] bg-card text-left ${
								i === 0 ? "shadow-[inset_0_0_0_2px_var(--color-ink)]" : "shadow-[inset_0_0_0_0.75px_var(--color-line)]"
							}`}
						>
							<img
								src={s.src}
								alt={s.file}
								className="aspect-[16/10] w-full object-cover object-left-top"
							/>
							<div className="flex items-center gap-1.5 px-3 py-2">
								<span className="text-[14px] leading-5 font-medium">{s.title}</span>
								<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">{s.file}</span>
								{i === 0 && <span className="icon-[lucide--check] size-4 shrink-0" />}
							</div>
						</div>
					))}
				</div>
				<button className="mt-2.5 w-full rounded-[16px] bg-card2 px-4 py-3 text-left text-[15px] leading-5">两张都放，跟随系统主题切换</button>
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
