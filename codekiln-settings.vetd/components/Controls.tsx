import type { ReactNode } from "react";

/** 徽章：与代码里的 Badge 对齐——字小、圆角 3、靠字重和底色区分层级。 */
const badgeTone = {
	plain: "bg-white/[0.07] text-muted",
	outline: "border border-border text-faint",
	brand: "bg-brand/15 text-brand",
	warn: "bg-warning/15 text-warning",
	danger: "bg-destructive/15 text-destructive",
	muted: "bg-white/[0.04] text-faint",
} as const;

export function Badge({
	children,
	tone = "plain",
}: {
	children: ReactNode;
	tone?: keyof typeof badgeTone;
}) {
	return (
		<span
			className={`shrink-0 rounded-[3px] px-[5px] py-[1px] text-[11px] leading-[14px] ${badgeTone[tone]}`}
		>
			{children}
		</span>
	);
}

export function Switch({ on, dim }: { on: boolean; dim?: boolean }) {
	return (
		<span
			className={`flex h-[18px] w-[32px] shrink-0 items-center rounded-full px-[3px] ${on ? "bg-brand" : "bg-border"} ${dim ? "opacity-45" : ""}`}
		>
			<span className={`size-[12px] rounded-full ${on ? "ml-auto bg-white" : "bg-muted"}`} />
		</span>
	);
}

export function Checkbox({ checked }: { checked: boolean }) {
	return (
		<span
			className={`flex size-[13px] shrink-0 items-center justify-center rounded-[3px] ${
				checked ? "bg-brand" : "border border-white/[0.22]"
			}`}
		>
			{checked ? <span className="icon-[lucide--check] size-[9px] text-white" /> : null}
		</span>
	);
}

const btnTone = {
	primary: "bg-foreground text-surface",
	brand: "bg-brand text-white",
	outline: "border border-border text-muted",
	ghost: "text-muted",
	danger: "border border-destructive/40 text-destructive",
} as const;

export function Btn({
	children,
	tone = "outline",
	disabled,
}: {
	children: ReactNode;
	tone?: keyof typeof btnTone;
	disabled?: boolean;
}) {
	return (
		<span
			className={`inline-flex h-[27px] shrink-0 items-center gap-1.5 rounded-[6px] px-[10px] text-[11.5px] leading-none ${btnTone[tone]} ${disabled ? "opacity-40" : ""}`}
		>
			{children}
		</span>
	);
}

export function Field({
	label,
	hint,
	children,
	grow,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
	grow?: boolean;
}) {
	return (
		<div className={`min-w-0 ${grow ? "flex-1" : ""}`}>
			<div className="flex items-baseline gap-2 pb-1">
				<span className="text-[11px] leading-[15px] text-muted">{label}</span>
				{hint ? (
					<span className="truncate text-[10.5px] leading-[14px] text-faint">{hint}</span>
				) : null}
			</div>
			{children}
		</div>
	);
}

export function Input({
	value,
	placeholder,
	mono,
	trailing,
	dim,
}: {
	value?: string;
	placeholder?: string;
	mono?: boolean;
	trailing?: ReactNode;
	dim?: boolean;
}) {
	return (
		<span
			className={`flex h-[30px] w-full items-center gap-2 rounded-[6px] border border-border px-2.5 ${dim ? "text-faint" : ""}`}
		>
			<span
				className={`min-w-0 flex-1 truncate text-[12px] leading-[16px] ${mono ? "font-mono text-[11.5px]" : ""} ${!value ? "text-faint" : ""}`}
			>
				{value ?? placeholder}
			</span>
			{trailing}
		</span>
	);
}

export function SelectBox({
	value,
	trailing,
	dim,
}: {
	value: string;
	trailing?: ReactNode;
	dim?: boolean;
}) {
	return (
		<span
			className={`flex h-[30px] w-full items-center gap-2 rounded-[6px] border border-border px-2.5 text-[12px] leading-[16px] ${dim ? "text-faint" : ""}`}
		>
			<span className="min-w-0 flex-1 truncate">{value}</span>
			{trailing ?? <span className="icon-[lucide--chevron-down] size-[12px] shrink-0 text-faint" />}
		</span>
	);
}

export function TextArea({ value, rows = 5 }: { value: string; rows?: number }) {
	return (
		<div
			className="w-full overflow-hidden whitespace-pre-wrap break-words rounded-[6px] border border-border px-2.5 py-2 font-mono text-[11px] leading-[17px] text-muted"
			style={{ height: rows * 17 + 16 }}
		>
			{value}
		</div>
	);
}

/** 模型选择器触发器：模型 id 在上，服务商在下，和聊天区同一个形状。 */
export function ModelSelect({
	model,
	provider,
	context,
	unset,
	stale,
}: {
	model: string;
	provider: string;
	context?: string;
	unset?: boolean;
	stale?: boolean;
}) {
	if (unset) {
		return (
			<span className="flex items-center gap-2">
				<span className="rounded-[5px] border border-dashed border-white/[0.2] px-[9px] py-[4px] text-[11.5px] leading-[15px] text-muted">
					未选择
				</span>
				<span className="icon-[lucide--chevron-down] size-[12px] text-faint" />
			</span>
		);
	}
	return (
		<span
			className={`flex min-w-0 items-center gap-2 rounded-[6px] border px-[9px] py-[3px] ${stale ? "border-warning/45" : "border-border"}`}
		>
			{stale ? (
				<span className="icon-[lucide--triangle-alert] size-[12px] shrink-0 text-warning" />
			) : null}
			<span className="min-w-0">
				<span
					className={`block truncate font-mono text-[11.5px] leading-[15px] ${stale ? "text-muted line-through" : ""}`}
				>
					{model}
				</span>
				<span className="block truncate text-[10.5px] leading-[14px] text-faint">
					{context ? `${provider} · ${context}` : provider}
				</span>
			</span>
			<span className="icon-[lucide--chevron-down] size-[12px] shrink-0 text-faint" />
		</span>
	);
}
