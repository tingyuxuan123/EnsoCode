import { Link } from "react-router";
import type { Print } from "./data";

/**
 * 照 `GeneratedImageCard` 的画法：图本体封顶 256 高、32rem 宽，
 * 右上角是半透明黑色悬浮按钮（编辑 / 复制 / 下载），没有图下的文字行。
 */
const ACTION =
	"flex size-8 items-center justify-center rounded-lg bg-black/42 text-white/90 backdrop-blur-[12px]";

export function ResultCard({ print }: { print: Print }) {
	return (
		<figure className="relative mt-2 overflow-hidden rounded-[12px] border border-foreground/10">
			<img
				src={print.src}
				alt={print.alt}
				className="block max-h-[256px] max-w-full object-contain"
			/>
			<div className="absolute top-1.5 right-1.5 flex items-center gap-1.5">
				<Link to="/thread" aria-label="编辑图片" title="编辑图片" className={ACTION}>
					<span className="icon-[lucide--pencil] size-4" />
				</Link>
				<button type="button" aria-label="复制图片" title="复制图片" className={ACTION}>
					<span className="icon-[lucide--copy] size-4" />
				</button>
				<button type="button" aria-label="下载图片" title="下载图片" className={ACTION}>
					<span className="icon-[lucide--download] size-4" />
				</button>
			</div>
		</figure>
	);
}
