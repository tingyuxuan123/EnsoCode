import type { ReactNode } from "react";
import { Link } from "react-router";

function Glyph({ w, h }: { w: number; h: number }) {
	return <span className="border border-current opacity-70" style={{ width: w, height: h }} />;
}

function Chip({ label, active, glyph }: { label: string; active?: boolean; glyph?: ReactNode }) {
	return (
		<span
			className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] ${
				active
					? "border-primary bg-primary/10 text-primary"
					: "border-border bg-card text-foreground"
			}`}
		>
			{glyph}
			{label}
		</span>
	);
}

function Select({ value }: { value: string }) {
	return (
		<div className="flex h-10 items-center justify-between rounded-lg border border-border bg-card px-3 text-[13px] text-foreground">
			<span>{value}</span>
			<span className="icon-[lucide--chevron-down] size-4 text-muted-foreground" />
		</div>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start gap-6">
			<p className="w-[64px] shrink-0 pt-2 text-[13px] text-muted-foreground">{label}</p>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

export function SettingsSheet() {
	return (
		<div className="w-[720px] overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-2xl">
			<header className="flex items-center gap-3 px-6 pt-5 pb-4">
				<span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
					<span className="icon-[lucide--sliders-horizontal] size-4" />
				</span>
				<h2 className="text-[16px] font-medium">画图设置</h2>
				<Link
					to="/thread"
					aria-label="关闭"
					className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60"
				>
					<span className="icon-[lucide--x] size-4" />
				</Link>
			</header>
			<div className="flex flex-col gap-4 px-6 pb-6">
				<Row label="数量">
					<Select value="1 张" />
					<p className="mt-1.5 text-[11px] text-muted-foreground">一次调用只出一张，失败不自动重试</p>
				</Row>
				<Row label="比例">
					<div className="flex flex-wrap gap-2">
						<Chip label="自动" active glyph={<span className="icon-[lucide--sparkles] size-3.5" />} />
						<Chip label="1:1" glyph={<Glyph w={10} h={10} />} />
						<Chip label="2:3" glyph={<Glyph w={10} h={15} />} />
						<Chip label="3:2" glyph={<Glyph w={15} h={10} />} />
						<Chip label="3:4" glyph={<Glyph w={10} h={13} />} />
						<Chip label="4:3" glyph={<Glyph w={13} h={10} />} />
						<Chip label="9:16" glyph={<Glyph w={9} h={16} />} />
						<Chip label="16:9" glyph={<Glyph w={16} h={9} />} />
					</div>
				</Row>
				<Row label="模型">
					<Select value="gpt-image-2.6" />
				</Row>
				<Row label="格式">
					<Select value="自动" />
				</Row>
				<Row label="分辨率">
					<div className="flex gap-2">
						<Chip label="自动" active />
						<Chip label="1K" />
						<Chip label="2K" />
						<Chip label="4K" />
					</div>
				</Row>
				<Row label="质量">
					<div className="flex gap-2">
						<Chip label="自动" active />
						<Chip label="低" />
						<Chip label="中" />
						<Chip label="高" />
					</div>
				</Row>
			</div>
			<footer className="flex items-center justify-between border-t border-border px-6 py-4">
				<p className="text-[12px] text-muted-foreground">默认 · 1 张 · 每次调用计费一次</p>
				<Link
					to="/thread"
					className="flex h-9 items-center rounded-md bg-primary px-4 text-[13px] text-primary-foreground"
				>
					完成
				</Link>
			</footer>
		</div>
	);
}
