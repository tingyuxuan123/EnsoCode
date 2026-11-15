export const frame = { width: 402, height: 874, radius: 62, title: "文件下载" };

import { Fragment } from "react";
import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";

const files = [
	{ name: "排期-第 43 周.md", size: "4.2 KB", kind: "text", state: "done", meta: "完成 · 12:14" },
	{ name: "hero@2x.png", size: "1.2 MB", kind: "image", state: "running", meta: "62% · 还剩 4 秒" },
	{ name: "sessionReducer.patch", size: "38 KB", kind: "patch", state: "failed", meta: "失败 · 点重试" },
	{ name: "回归报告 · 第 42 周.md", size: "12 KB", kind: "text", state: "done", meta: "完成 · 12:14" },
	{ name: "排期素材.zip", size: "2.1 MB", kind: "patch", state: "done", meta: "完成 · 11:02" },
	{ name: "设计稿-黑白.zip", size: "4.2 MB", kind: "patch", state: "done", meta: "完成 · 昨天 18:20" },
	{ name: "会话导出.json", size: "1.8 MB", kind: "text", state: "done", meta: "完成 · 昨天 09:05" },
	{ name: "截图-20261113.png", size: "420 KB", kind: "image", state: "done", meta: "完成 · 昨天 08:40" },
];

// 下载列表：三个状态各占一行，失败的那行右侧红字，不额外弹窗。
export default function Files() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/sessions"
				title="文件"
				detail="8 个文件 · 9.8 MB"
			>
				<button
					aria-label="清理已完成"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--trash-2] size-[22px]" />
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1 pb-28">
			{files.map((f, i) => (
				<Fragment key={f.name}>
					{i === 5 && (
						<p className="pt-5 pb-1 text-[13px] leading-[18px] font-medium text-dim">更早</p>
					)}
					<div
						className={`flex items-center gap-3 py-3 ${i > 0 ? "border-line/70 border-t" : ""}`}
					>
						<span className="flex w-7 shrink-0 items-center justify-center text-ink2">
							<span
								className={`${
									f.kind === "image"
										? "icon-[lucide--image]"
										: f.kind === "patch"
											? "icon-[lucide--git-compare]"
											: "icon-[lucide--file-text]"
								} size-[22px]`}
							/>
						</span>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[15px] leading-[21px] font-medium">{f.name}</p>
							<p
								className={`truncate text-[12px] leading-4 tabular-nums ${
									f.state === "failed" ? "text-red" : "text-dim"
								}`}
							>
								{f.size} · {f.meta}
							</p>
							{f.state === "running" && (
								<span className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-card2">
									<span
										className="h-full rounded-full bg-ink2"
										style={{ width: "62%" }}
									/>
								</span>
							)}
						</div>
						{f.state === "done" && (
							<span className="icon-[lucide--circle-check] size-5 shrink-0 text-green" />
						)}
						{f.state === "running" && (
							<span className="icon-[lucide--x] size-5 shrink-0 text-faint" />
						)}
						{f.state === "failed" && (
							<span className="shrink-0 text-[13px] leading-5 font-medium text-red">重试</span>
						)}
					</div>
				</Fragment>
				))}
			</div>
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-page via-page/85 to-transparent" />
			<div className="absolute inset-x-4 bottom-8">
				<button className="glass-ink flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-medium">
					<span className="icon-[lucide--download] size-5" />
					全部下载到「文件」
				</button>
			</div>
		</div>
	);
}
