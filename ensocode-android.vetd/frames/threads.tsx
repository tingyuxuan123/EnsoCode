export const frame = { width: 412, height: 915, title: "线程" };

import { Link } from "react-router";
import { Sheet } from "../components/Sheet";
import Group from "./group";

const threads = [
	{ title: "v1 规划", meta: "12 条 · 刚刚", current: true },
	{ title: "FCM 推送方案", meta: "6 条 · 1 小时前" },
	{ title: "图标与启动页", meta: "3 条 · 昨天" },
	{ title: "Demo 模式过审", meta: "9 条 · 周三" },
];

/** 线程：同一个群、同一批成员，换一个干净的上下文聊另一件事（bot-thread-*）。 */
export default function Threads() {
	return (
		<div className="relative h-full overflow-hidden">
			<Group />
			<Sheet
				backTo="/group"
				title="Eaves 安卓版 · 线程"
			>
				<div className="mx-3 overflow-hidden rounded-[20px] bg-card">
					{threads.map((t, i) => (
						<Link
							key={t.title}
							to="/group"
							className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "shadow-[inset_0_0.75px_0_var(--color-line)]" : ""}`}
						>
							<span className="icon-[lucide--message-square-text] size-5 shrink-0 text-ink2" />
							<div className="min-w-0 flex-1">
								<div className="truncate text-[16px] leading-[22px] font-medium">{t.title}</div>
								<div className="text-[12px] leading-4 text-dim tabular-nums">{t.meta}</div>
							</div>
							{t.current && <span className="icon-[lucide--check] size-5 shrink-0" />}
						</Link>
					))}
				</div>
				<p className="px-6 pt-3 text-[13px] leading-[18px] text-dim">新线程里成员从空白上下文开始，群成员和主持人不变。</p>
				<div className="mt-4 px-4">
					<button className="glass-ink flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium">
						<span className="icon-[lucide--plus] size-5" />
						新线程
					</button>
				</div>
			</Sheet>
		</div>
	);
}
