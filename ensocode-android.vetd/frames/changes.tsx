export const frame = { width: 412, height: 915, title: "改动审查" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";

type Line = { n: number; kind: " " | "+" | "-"; text: string };

const hunk: Line[] = [
	{ n: 84, kind: " ", text: "case 'session/restored': {" },
	{ n: 85, kind: "-", text: "  return { ...state, events: [] }" },
	{ n: 85, kind: "+", text: "  const first = event.replay[0]?.seq ?? 0" },
	{ n: 86, kind: "+", text: "  return {" },
	{ n: 87, kind: "+", text: "    ...state," },
	{ n: 88, kind: "+", text: "    lastSeq: first - 1," },
	{ n: 89, kind: "+", text: "    events: []," },
	{ n: 90, kind: "+", text: "  }" },
	{ n: 91, kind: " ", text: "}" },
	{ n: 92, kind: " ", text: "case 'session/event': {" },
	{ n: 93, kind: " ", text: "  if (event.seq <= state.lastSeq) return state" },
];

const rowTone = {
	" ": "",
	"+": "bg-green/[0.09]",
	"-": "bg-red/[0.07]",
};

const markTone = {
	" ": "text-faint",
	"+": "text-green",
	"-": "text-red",
};

/** 改动审查：本次会话改过的文件，展开一个看 diff；底部可回退到检查点或让它提交。 */
export default function Changes() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/session"
				title="改动"
				detail="会话恢复后时间线为空"
			/>
			<div className="px-5 pt-1 pb-4">
				<div className="flex rounded-full bg-card2 p-1 text-[14px] leading-5 font-medium">
					<button className="flex-1 rounded-full bg-card py-2 shadow-[0_1px_3px_rgb(0_0_0/0.08)]">本次会话</button>
					<button className="flex-1 py-2 text-dim">工作区 Git</button>
				</div>
				<p className="mt-4 flex items-baseline gap-2 px-1">
					<span className="text-[15px] leading-5 font-semibold">2 个文件</span>
					<span className="font-mono text-[13px] text-green">+38</span>
					<span className="font-mono text-[13px] text-red">−6</span>
					<span className="ml-auto text-[12px] leading-4 text-dim">检查点 · 14:05</span>
				</p>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden px-3">
				<section className="overflow-hidden rounded-[20px] bg-card">
					<div className="flex items-center gap-3 px-4 py-3.5">
						<span className="icon-[lucide--file-code-2] size-5 text-ink2" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-[15px] leading-5 font-medium">sessionReducer.ts</div>
							<div className="truncate text-[12px] leading-4 text-dim">src/renderer/store</div>
						</div>
						<span className="font-mono text-[13px] text-green">+12</span>
						<span className="font-mono text-[13px] text-red">−6</span>
						<span className="icon-[lucide--chevron-up] size-4 text-faint" />
					</div>
					<div className="bg-card2/70 px-4 py-1.5 font-mono text-[12px] leading-[18px] text-dim">@@ -84,9 +84,15 @@ applyEvent</div>
					<div className="py-1 font-mono text-[12.5px] leading-[22px]">
						{hunk.map((l, i) => (
							<div
								key={i}
								className={`flex ${rowTone[l.kind]}`}
							>
								<span className="w-10 shrink-0 pr-2 text-right text-faint">{l.n}</span>
								<span className={`w-4 shrink-0 ${markTone[l.kind]}`}>{l.kind === "-" ? "−" : l.kind}</span>
								<span className="min-w-0 flex-1 truncate pr-3 whitespace-pre">{l.text}</span>
							</div>
						))}
					</div>
					<button className="flex w-full items-center gap-2 px-4 py-3 text-[14px] leading-5 text-ink2 shadow-[inset_0_0.75px_0_var(--color-line)]">
						<span className="icon-[lucide--unfold-vertical] size-4" />
						还有 2 处改动
					</button>
				</section>
				<section className="mt-3 flex items-center gap-3 rounded-[20px] bg-card px-4 py-3.5">
					<span className="icon-[lucide--flask-conical] size-5 text-ink2" />
					<div className="min-w-0 flex-1">
						<div className="truncate text-[15px] leading-5 font-medium">sessionReducer.test.ts</div>
						<div className="truncate text-[12px] leading-4 text-dim">src/renderer/store/__tests__ · 新文件</div>
					</div>
					<span className="font-mono text-[13px] text-green">+26</span>
					<span className="icon-[lucide--chevron-down] size-4 text-faint" />
				</section>
			</div>
			<div className="flex gap-2.5 px-4 pt-3 pb-8">
				<button className="glass flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium">
					<span className="icon-[lucide--history] size-5" />
					回退到检查点
				</button>
				<button className="glass-ink flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium">
					<span className="icon-[lucide--git-commit-horizontal] size-5" />
					让它提交
				</button>
			</div>
		</div>
	);
}
