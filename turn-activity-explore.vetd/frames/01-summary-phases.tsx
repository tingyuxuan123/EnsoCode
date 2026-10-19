export const frame = { width: 1440, height: 900, title: "方案 A · 折叠摘要 + 阶段分组" };

import { ChatColumn, ReplyHead, Shell, UserTurn } from "../components/Shell";

const PHASES = [
	{
		name: "探查骨架",
		thinking: "4.2s",
		calls: 11,
		open: true,
		steps: [
			{ tool: "终端", icon: "icon-[lucide--square-terminal]", text: "ls .", time: "0s" },
			{ tool: "读取", icon: "icon-[lucide--file-text]", text: "package.json", time: "0s" },
			{ tool: "终端", icon: "icon-[lucide--square-terminal]", text: 'echo "=== src ===" && ls src', time: "0.3s" },
			{ tool: "终端", icon: "icon-[lucide--square-terminal]", text: "find src -maxdepth 2 -type d | sort", time: "0.3s" },
			{ tool: "终端", icon: "icon-[lucide--square-terminal]", text: 'ls src/main src/agent src/renderer/components', time: "0.1s" },
			{ tool: "读取", icon: "icon-[lucide--file-text]", text: "src/main/index.ts", time: "0s" },
			{ tool: "终端", icon: "icon-[lucide--square-terminal]", text: "ls docs docs/engineering-reference", time: "0.1s" },
			{ tool: "终端", icon: "icon-[lucide--square-terminal]", text: "ls src/agent | grep -v test | head -80", time: "0.1s" },
		],
		more: 3,
		denied: false,
	},
	{
		name: "读取入口与 IPC",
		thinking: "2.9s",
		calls: 6,
		open: false,
		steps: [],
		more: 0,
		denied: false,
	},
	{
		name: "核对依赖边界",
		thinking: "1.6s",
		calls: 5,
		open: false,
		steps: [],
		more: 0,
		denied: true,
	},
];

export default function SummaryPhases() {
	return (
		<Shell label="方案 A · 折叠摘要 + 阶段分组">
			<ChatColumn>
				<UserTurn text="梳理一下这个项目的结构：入口、模块划分与关键依赖" />
				<div className="flex flex-col gap-3">
					<ReplyHead />
					<div className="flex flex-col gap-1">
						<div className="flex h-7 items-center gap-2 rounded-lg text-[12px] text-muted-foreground">
							<span className="size-1.5 shrink-0 rounded-full bg-success" />
							<span>已工作 20.9s</span>
							<span className="text-border">·</span>
							<span>3 个阶段</span>
							<span className="text-border">·</span>
							<span>22 次调用</span>
							<span className="icon-[lucide--chevron-right] size-3" />
						</div>
						<div className="flex flex-col gap-px">
							{PHASES.map((phase) => (
								<div key={phase.name}>
									<div className="flex h-7 items-center gap-1.5 text-[12px]">
										<span
											className={`icon-[lucide--chevron-right] size-3 text-muted-foreground ${phase.open ? "rotate-90" : ""}`}
										/>
										<span className={`font-medium ${phase.open ? "text-foreground" : "text-muted-foreground"}`}>
											{phase.name}
										</span>
										<span className="text-muted-foreground">思考 {phase.thinking}</span>
										<span className="text-border">·</span>
										<span className="text-muted-foreground">{phase.calls} 次调用</span>
										{phase.denied && (
											<span className="ml-1 rounded bg-warning/12 px-1.5 py-px text-[10px] text-warning">
												1 次被拒
											</span>
										)}
									</div>
									{phase.open && (
										<div className="flex flex-col pb-1 pl-5">
											{phase.steps.map((step) => (
												<div
													key={step.text}
													className="flex h-[26px] items-center gap-2 text-[12px]"
												>
													<span
														className={`${step.icon} size-3.5 shrink-0 text-muted-foreground`}
													/>
													<span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">
														{step.text}
													</span>
													<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
														{step.time}
													</span>
												</div>
											))}
											<div className="flex h-[24px] items-center gap-2 pl-5 text-[11px] text-muted-foreground">
												还有 {phase.more} 次调用
											</div>
										</div>
									)}
								</div>
							))}
						</div>
					</div>
					<p className="text-[13px] leading-6">
						项目分三层：<span className="font-mono text-[12px]">src/main</span> 负责窗口与 IPC，
						<span className="font-mono text-[12px]">src/agent</span> 是会话与工具执行，
						<span className="font-mono text-[12px]">src/renderer</span> 只有 UI。跨层调用全部经由 preload 的类型化出口。
					</p>
				</div>
			</ChatColumn>
		</Shell>
	);
}
