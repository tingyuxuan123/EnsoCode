import type { ReactNode } from "react";
import { MemberAvatar } from "./Brand";

// 一段工作的折叠行：默认只给「做了多少、结果如何」，点开才是每一步。
// 这是把「开工／交付／委派／验收」从正文降级成活动行的唯一出口。
export function ActivityRow({
	summary,
	state,
	live = false,
}: {
	summary: string;
	state?: string;
	live?: boolean;
}) {
	return (
		<div className="flex items-center gap-2 rounded-[14px] bg-card2/70 px-3 py-2.5 text-[13px] leading-[18px] text-dim">
			{live ? (
				<span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-blue/25 border-t-blue" />
			) : (
				<span className="icon-[lucide--circle-check] size-4 shrink-0" />
			)}
			<span className="min-w-0 flex-1 truncate">{summary}</span>
			{state && <span className="shrink-0 text-[11px] leading-4 text-ink2">{state}</span>}
			<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
		</div>
	);
}

// 一句话派给了几个 Bot：主线程只留这一行，点开才是每个 Bot 各自的回复。
export function FanOutRow({ names, label }: { names: string[]; label: string }) {
	return (
		<div className="flex items-center gap-2.5 rounded-[16px] bg-card px-3 py-2.5">
			<div className="flex -space-x-1.5">
				{names.slice(0, 3).map((n) => (
					<MemberAvatar
						key={n}
						name={n}
						size={24}
					/>
				))}
			</div>
			<span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium">{label}</span>
			<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
		</div>
	);
}

// 时间轴分段：一段对话只留一行摘要，长线程才有呼吸。不画线，靠留白。
export function SegmentLead({ children }: { children: string }) {
	return <p className="py-3.5 text-center text-[11px] leading-4 text-faint">{children}</p>;
}

// 一个 Bot 的一句话回执（扇出的结果）：头像 + 名字 + 一句结论。
export function ReplyBrief({ name, text }: { name: string; text: string }) {
	return (
		<div className="flex items-start gap-2.5 px-3 py-2.5">
			<MemberAvatar
				name={name}
				size={22}
			/>
			<p className="min-w-0 flex-1 text-[13px] leading-[19px]">
				<span className="font-medium">{name}</span>
				<span className="text-dim">：{text}</span>
			</p>
		</div>
	);
}

// 角色胶囊：书记、舰员那种身份标签。
export function RoleChip({ children }: { children: ReactNode }) {
	return (
		<span className="shrink-0 rounded-full bg-card2 px-1.5 py-0.5 text-[11px] leading-4 font-medium text-dim">
			{children}
		</span>
	);
}

// 聊天列表的一行：人和群都在同一张表里，按时间排。行的第二行是最后一句，
// Bot 之间的转达就在这句前面加一个「来自 X」的记号，不再单开一屏。
export function ChatListRow({
	name,
	role,
	preview,
	via,
	time,
	dot,
	stacked,
	badge,
}: {
	name: string;
	role?: string;
	preview: string;
	via?: string;
	time: string;
	dot?: "waiting" | "running";
	/** 群聊：叠两个头像 + 剩余人数 */
	stacked?: string[];
	badge?: string;
}) {
	return (
		<div className="flex items-start gap-3 py-3">
			{stacked ? (
				<div className="relative flex h-10 w-10 shrink-0 items-center">
					<div className="flex -space-x-3">
						{stacked.slice(0, 2).map((n) => (
							<MemberAvatar
								key={n}
								name={n}
								size={26}
							/>
						))}
					</div>
					{stacked.length > 2 && (
						<span className="absolute -right-0.5 -bottom-1 rounded-full border-2 border-page bg-card2 px-1 text-[11px] leading-4 font-medium text-dim">
							+{stacked.length - 2}
						</span>
					)}
				</div>
			) : (
				<MemberAvatar
					name={name}
					size={40}
				/>
			)}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<p className="min-w-0 truncate text-[16px] leading-[22px] font-medium">{name}</p>
					{badge && <RoleChip>{badge}</RoleChip>}
					{role && <RoleChip>{role}</RoleChip>}
					<div className="flex-1" />
					<span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">{time}</span>
				</div>
				<div className="mt-0.5 flex items-center gap-2">
					{via ? (
						<span className="flex min-w-0 flex-1 items-center gap-1">
							<span className="icon-[lucide--corner-down-right] size-3.5 shrink-0 text-faint" />
							<span className="min-w-0 truncate text-[13px] leading-[18px] text-dim">
								<span className="text-ink2">来自 {via}</span>：{preview}
							</span>
						</span>
					) : (
						<span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-dim">{preview}</span>
					)}
					{dot && (
						<span
							className={`size-2 shrink-0 rounded-full ${dot === "waiting" ? "bg-yellow" : "bg-blue"}`}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
