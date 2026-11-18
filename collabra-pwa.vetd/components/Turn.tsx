import type { ReactNode } from "react";
import { AgentAvatar, RunningMark } from "./Brand";

// 用户自己的消息：反色胶囊，右下角收尖。
export function UserBubble({ children }: { children: ReactNode }) {
	return (
		<div className="flex justify-end pb-5 pl-12">
			<p className="rounded-[20px] rounded-br-md bg-pill px-4 py-3 text-[16px] leading-[22px] text-pill-ink">
				{children}
			</p>
		</div>
	);
}

// 一轮回复的抬头：头像、名字、时间；进行中再跟蓝弧和它在做什么。
export function TurnHead({
	name = "CodeKiln",
	time,
	live,
}: {
	name?: string;
	time: string;
	live?: string;
}) {
	return (
		<div className="flex items-center gap-2">
			<AgentAvatar
				size={22}
				working={!!live}
			/>
			<span className="text-[15px] leading-5 font-semibold">{name}</span>
			<span className="text-[12px] leading-4 text-dim">{time}</span>
			{live && (
				<span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-dim">
					<RunningMark size={12} />
					<span className="truncate">{live}</span>
				</span>
			)}
		</div>
	);
}

// 折叠起来的工作步骤：完成后数步数，进行中显示当前这一步。
export function Steps({ children, live = false }: { children: ReactNode; live?: boolean }) {
	return (
		<div className="flex items-center gap-2 rounded-[14px] bg-card2/70 px-3 py-2.5 text-[14px] leading-5 text-dim">
			{live ? (
				<RunningMark size={12} />
			) : (
				<span className="icon-[lucide--circle-check] size-4 shrink-0" />
			)}
			<span className={`min-w-0 flex-1 truncate ${live ? "font-mono text-[13px]" : ""}`}>{children}</span>
			<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
		</div>
	);
}

export function Prose({ children }: { children: ReactNode }) {
	return <div className="flex flex-col gap-2.5 text-[15px] leading-6 text-ink">{children}</div>;
}

export function Code({ children }: { children: string }) {
	return (
		<code className="rounded-md bg-card2 px-1.5 py-px font-mono text-[13.5px] whitespace-nowrap text-ink">
			{children}
		</code>
	);
}

// 改动摘要：白卡一行，绿加红减。
export function DiffCard({ files, add, del }: { files: number; add: number; del: number }) {
	return (
		<div className="flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3 shadow-[0_0_0_0.75px_rgb(0_0_0/0.04)]">
			<span className="icon-[lucide--file-diff] size-[18px] text-ink2" />
			<span className="flex-1 text-[14px] leading-5 font-medium">改动了 {files} 个文件</span>
			<span className="font-mono text-[13px] text-green">+{add}</span>
			<span className="font-mono text-[13px] text-red">−{del}</span>
			<span className="icon-[lucide--chevron-right] size-4 text-faint" />
		</div>
	);
}
