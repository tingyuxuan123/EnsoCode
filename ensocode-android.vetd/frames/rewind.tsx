export const frame = { width: 412, height: 915, title: "回退" };

import { Sheet, SheetLabel } from "../components/Sheet";
import Session from "./session";

const turns = [
	{ text: "顺便把 reducer 里的 console.log 都删掉", time: "14:18", after: "之后改了 1 个文件" },
	{ text: "先别动 worker，只改 renderer 这一层", time: "14:09", after: "之后改了 2 个文件", chosen: true },
	{ text: "恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。", time: "14:02", after: "会话开始" },
];

/** 回退：选回到哪条消息之前，以及是否把那之后的文件改动一起撤销（rewind restoreFiles）。 */
export default function Rewind() {
	return (
		<div className="relative h-full overflow-hidden">
			<Session />
			<Sheet
				backTo="/session-menu"
				title="回退到这条消息之前"
			>
				<div className="mx-3 overflow-hidden rounded-[20px] bg-card">
					{turns.map((t, i) => (
						<div
							key={t.time}
							role="radio"
							aria-checked={!!t.chosen}
							className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "shadow-[inset_0_0.75px_0_var(--color-line)]" : ""}`}
						>
							<span className="flex h-[22px] shrink-0 items-center">
								<span
									className={`flex size-5 items-center justify-center rounded-full ${
										t.chosen ? "bg-pill text-pill-ink" : "shadow-[inset_0_0_0_1.5px_var(--color-faint)]"
									}`}
								>
									{t.chosen && <span className="icon-[lucide--check] size-3.5" />}
								</span>
							</span>
							<div className="min-w-0 flex-1">
								<p className="line-clamp-2 text-[15px] leading-[22px]">{t.text}</p>
								<p className="mt-0.5 text-[12px] leading-4 text-dim tabular-nums">
									{t.time} · {t.after}
								</p>
							</div>
						</div>
					))}
				</div>
				<SheetLabel>文件</SheetLabel>
				<div className="mx-3 flex items-center gap-3 rounded-[20px] bg-card px-4 py-3.5">
					<div className="min-w-0 flex-1">
						<div className="text-[15px] leading-5 font-medium">同时恢复文件</div>
						<div className="mt-0.5 text-[12px] leading-4 text-dim">撤销这条之后的 3 处改动，回到 14:09 的检查点</div>
					</div>
					<span className="flex h-7 w-12 shrink-0 items-center justify-end rounded-full bg-pill p-0.5">
						<span className="size-6 rounded-full bg-card" />
					</span>
				</div>
				<p className="px-6 pt-3 text-[13px] leading-[18px] text-dim">这条消息和之后的对话会从会话里移除，桌面上同步生效。</p>
				<div className="mt-4 px-4">
					<button className="glass-ink flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium">
						<span className="icon-[lucide--undo-2] size-5" />
						回退并恢复 3 处改动
					</button>
				</div>
			</Sheet>
		</div>
	);
}
