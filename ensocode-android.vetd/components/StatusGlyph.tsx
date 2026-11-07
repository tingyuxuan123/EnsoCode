import type { Status } from "./data";

/**
 * 状态只在需要你看一眼时出现（StatusGlyph.kt）：
 * 运行中蓝色旋转、等你回复黄色呼吸的问号、出错红色叹号；完成和空闲不画。
 */
export function StatusGlyph({ status, size = 16 }: { status: Status; size?: number }) {
	const style = { width: size, height: size };
	if (status === "running") {
		return (
			<span
				className="icon-[mdi--sync] shrink-0 animate-[spin_1.4s_linear_infinite] text-blue [animation-direction:reverse]"
				style={style}
			/>
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
