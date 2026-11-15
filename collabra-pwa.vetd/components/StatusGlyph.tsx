import { RunningMark } from "./Brand";

export type Status = "running" | "waiting" | "error" | "done" | "idle";

// 状态只在需要你看一眼时出现：运行中蓝弧、等你回复黄色呼吸问号、出错红色叹号；完成和空闲不画。
export function StatusGlyph({ status, size = 16 }: { status: Status; size?: number }) {
	if (status === "running") return <RunningMark size={size} />;
	if (status === "waiting") {
		return (
			<span
				aria-label="等你处理"
				className="icon-[lucide--circle-help] shrink-0 animate-pulse text-yellow"
				style={{ width: size, height: size }}
			/>
		);
	}
	if (status === "error") {
		return (
			<span
				aria-label="出错"
				className="icon-[lucide--triangle-alert] shrink-0 text-red"
				style={{ width: size, height: size }}
			/>
		);
	}
	return null;
}
