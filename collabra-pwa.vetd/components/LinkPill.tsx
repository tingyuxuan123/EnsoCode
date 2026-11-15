// 连接状态：一颗绿点 + 电脑名，点一下切设备。
export function LinkPill({
	label = "书房",
	online = true,
	compact = false,
}: {
	label?: string;
	online?: boolean;
	compact?: boolean;
}) {
	return (
		<span
			className={`flex shrink-0 items-center gap-1.5 rounded-full bg-card2 ${
				compact ? "h-6 px-2" : "h-8 px-3"
			}`}
		>
			<span className={`size-1.5 rounded-full ${online ? "bg-green" : "bg-faint"}`} />
			<span className={`${compact ? "text-[11px]" : "text-[12px]"} leading-4 font-medium text-ink2`}>
				{online ? label : "离线"}
			</span>
		</span>
	);
}
