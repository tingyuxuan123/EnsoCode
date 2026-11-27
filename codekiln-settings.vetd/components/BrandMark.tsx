import { MagpieMark } from "./MagpieMark";

/** 服务商品牌标：Iconify simple-icons（官方 mark），用品牌色染色，18px；Magpie 用其官方 svg。 */
const marks: Record<string, { icon: string; color: string }> = {
	anthropic: { icon: "icon-[simple-icons--anthropic]", color: "#d97757" },
	openai: { icon: "icon-[simple-icons--openai]", color: "#ffffff" },
	deepseek: { icon: "icon-[simple-icons--deepseek]", color: "#4d6bfe" },
	gemini: { icon: "icon-[simple-icons--googlegemini]", color: "#5b8def" },
	kimi: { icon: "icon-[simple-icons--kimi]", color: "#c9c9cf" },
	xai: { icon: "icon-[simple-icons--x]", color: "#ffffff" },
	qwen: { icon: "icon-[simple-icons--qwen]", color: "#8b5cf6" },
	mistral: { icon: "icon-[simple-icons--mistralai]", color: "#fa520f" },
	ollama: { icon: "icon-[simple-icons--ollama]", color: "#ffffff" },
	openrouter: { icon: "icon-[simple-icons--openrouter]", color: "#a5a5ab" },
	minimax: { icon: "icon-[simple-icons--minimax]", color: "#f24f7c" },
};

export function BrandMark({ brand }: { brand: keyof typeof marks | "zhipu" | "magpie" }) {
	if (brand === "zhipu") {
		return (
			<span className="flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-zhipu/18 text-[10px] font-bold leading-none text-zhipu-soft">
				Z
			</span>
		);
	}
	if (brand === "magpie") {
		return (
			<span className="flex size-[18px] shrink-0 items-center justify-center">
				<MagpieMark size={17} />
			</span>
		);
	}
	const mark = marks[brand];
	if (!mark) return <span className="size-[18px] shrink-0" />;
	return (
		<span
			className="flex size-[18px] shrink-0 items-center justify-center"
			style={{ color: mark.color }}
		>
			<span className={`${mark.icon} size-[16px]`} />
		</span>
	);
}
