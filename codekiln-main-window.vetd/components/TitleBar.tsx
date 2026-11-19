/** 标题栏：左侧只留红绿灯的位置，中间 Code | Bot，右侧三个显示控制。 */
export function TitleBar() {
	return (
		<header className="flex h-11 shrink-0 items-center bg-rail pr-3 pl-[84px]">
			<div className="flex flex-1 items-center" />
			<div className="flex h-7 items-center gap-0.5 rounded-block bg-track p-0.5">
				<span className="flex h-6 items-center gap-1.5 rounded-[6px] bg-paper px-2.5 text-[12.5px] font-medium shadow-[0_0_0_0.5px_rgb(0_0_0/6%),0_1px_2px_rgb(0_0_0/5%)]">
					<span className="icon-[lucide--square-terminal] size-[15px]" />
					Code
				</span>
				<span className="flex h-6 items-center gap-1.5 px-2.5 text-[12.5px] text-muted">
					<span className="icon-[lucide--bot-message-square] size-[15px]" />
					Bot
				</span>
			</div>
			<div className="flex flex-1 items-center justify-end gap-1.5 text-muted">
				<span className="icon-[lucide--unfold-horizontal] size-[15px]" />
				<span className="icon-[lucide--smartphone] size-[15px]" />
				<span className="icon-[lucide--panel-right] size-[15px]" />
			</div>
		</header>
	);
}
