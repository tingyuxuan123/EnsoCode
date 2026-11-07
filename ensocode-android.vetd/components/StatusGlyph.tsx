import type { Status } from "./data";
import { RunningMark } from "./Eaves";

/**
 * 状态只在需要你看一眼时出现（StatusGlyph.kt）：
 * 运行中雨帘、等你回复黄色呼吸的问号、出错红色叹号；完成和空闲不画。
 */
export function StatusGlyph({ status, size = 16 }: { status: Status; size?: number }) {
	const style = { width: size, height: size };
	if (status === "running") {
		return (
			<RunningMark size={size} />
		);
	}
	if (status === "waiting") {
		return (
			<span
				className="icon-[mdi--help] shrink-0 animate-pulse text-yellow"
				style={style}
			/>
		);
	}
	if (status === "error") {
		return (
			<span
				className="icon-[mdi--exclamation-thick] shrink-0 text-red"
				style={style}
			/>
		);
	}
	return null;
}
