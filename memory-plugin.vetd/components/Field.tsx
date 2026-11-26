export function Toggle({ on }: { on: boolean }) {
	return (
		<span
			className={`relative flex h-4 w-7 shrink-0 items-center rounded-full ${
				on ? "bg-surface-foreground" : "bg-line"
			}`}
		>
			<span
				className={`absolute size-3 rounded-full ${
					on ? "right-0.5 bg-surface" : "left-0.5 bg-faint"
				}`}
			/>
		</span>
	);
}

export function Select({ value, width = "w-[176px]" }: { value: string; width?: string }) {
	return (
		<span
			className={`flex h-8 ${width} items-center gap-2 rounded-card border border-line bg-panel px-2.5 text-[12px] text-surface-foreground`}
		>
			<span className="truncate">{value}</span>
			<span className="icon-[lucide--chevron-down] ml-auto size-3.5 shrink-0 text-faint" />
		</span>
	);
}

export function Input({ value, unit }: { value: string; unit?: string }) {
	return (
		<span className="flex h-8 w-[176px] items-center gap-2 rounded-card border border-line bg-panel px-2.5 font-mono text-[12px] tabular-nums">
			<span>{value}</span>
			{unit && <span className="ml-auto text-[11px] text-faint">{unit}</span>}
		</span>
	);
}

export function Setting({
	title,
	description,
	control,
}: {
	title: string;
	description?: string;
	control: React.ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-6 border-t border-line-soft py-3.5 first:border-t-0 first:pt-0">
			<div className="min-w-0">
				<p className="text-[13px] text-surface-foreground">{title}</p>
				{description && (
					<p className="mt-1 max-w-[46ch] text-[11.5px] leading-[1.6] text-muted">{description}</p>
				)}
			</div>
			<div className="shrink-0 pt-0.5">{control}</div>
		</div>
	);
}
