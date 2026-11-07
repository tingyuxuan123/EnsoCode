import type { ReactNode } from "react";
import { AgentAvatar } from "./Enso";

/** 用户自己的消息：反色胶囊，右下角收尖（ChatBlocks.kt UserBubble）。 */
export function UserBubble({ children }: { children: ReactNode }) {
	return (
		<div className="flex justify-end pb-5 pl-12">
			<p className="rounded-[20px] rounded-br-md bg-pill px-4 py-3 text-[16px] leading-[22px] text-pill-ink">{children}</p>
		</div>
	);
}

/** 一轮回复的抬头：头像、名字、时间；进行中再跟一个转圈和它在做什么。 */
export function TurnHead({ name = "EnsoCode", time, live }: { name?: string; time: string; live?: string }) {
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
					<span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-dim border-t-transparent" />
					<span className="truncate">{live}</span>
				</span>
			)}
		</div>
	);
}

/** 折叠起来的工作步骤（WorkGroupView）：完成后数步数，进行中显示当前这一步。 */
export function Steps({ children, live = false }: { children: ReactNode; live?: boolean }) {
	return (
		<div className="flex items-center gap-2 rounded-[14px] bg-card2/60 px-3 py-2.5 text-[14px] leading-5 text-dim">
			{live ? (
				<span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-dim border-t-transparent" />
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
	return <code className="rounded-md bg-card2 px-1.5 py-px font-mono text-[13.5px] whitespace-nowrap text-ink">{children}</code>;
}
