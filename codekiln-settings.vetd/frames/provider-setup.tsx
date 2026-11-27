export const frame = { width: 1440, height: 900, title: "添加服务商 · 选择厂商" };

import { BrandMark } from "../components/BrandMark";
import { Badge, Btn } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";

type Vendor = {
	name: string;
	brand:
		| "anthropic"
		| "openai"
		| "gemini"
		| "xai"
		| "deepseek"
		| "openrouter"
		| "kimi"
		| "zhipu"
		| "qwen"
		| "minimax"
		| "mistral"
		| "ollama";
	methods: Array<"订阅" | "API Key">;
};

/** 同一份厂商表按常用度排序，前 12 个进首屏；其余进搜索。 */
const vendors: Vendor[] = [
	{ name: "Claude", brand: "anthropic", methods: ["订阅", "API Key"] },
	{ name: "OpenAI", brand: "openai", methods: ["订阅", "API Key"] },
	{ name: "Gemini", brand: "gemini", methods: ["订阅", "API Key"] },
	{ name: "Grok", brand: "xai", methods: ["订阅", "API Key"] },
	{ name: "DeepSeek", brand: "deepseek", methods: ["API Key"] },
	{ name: "OpenRouter", brand: "openrouter", methods: ["API Key"] },
	{ name: "Kimi", brand: "kimi", methods: ["API Key"] },
	{ name: "智谱 GLM", brand: "zhipu", methods: ["API Key"] },
	{ name: "通义千问", brand: "qwen", methods: ["API Key"] },
	{ name: "MiniMax", brand: "minimax", methods: ["API Key"] },
	{ name: "Mistral", brand: "mistral", methods: ["API Key"] },
	{ name: "Ollama", brand: "ollama", methods: ["API Key"] },
];

export default function ProviderSetup() {
	return (
		<Window
			overlay={
				<Modal
					title="添加模型或服务商"
					note="先选厂商，下一步选订阅登录或 API Key"
					width={860}
					footer={
						<>
							<span className="text-[11px] text-faint">
								共 18 个厂商 · 已登录的订阅账号会直接复用，不会重复建条目
							</span>
							<span className="ml-auto">
								<Btn>取消</Btn>
							</span>
						</>
					}
				>
					<div className="grid grid-cols-3 gap-2">
						{vendors.map((vendor) => (
							<div
								key={vendor.name}
								className="flex min-w-0 items-center gap-3 rounded-[7px] border border-white/[0.07] px-3 py-2.5 hover:border-white/[0.14] hover:bg-white/[0.02]"
							>
								<span className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] bg-white/[0.05]">
									<BrandMark brand={vendor.brand} />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[12.5px] leading-[17px]">{vendor.name}</span>
									<span className="mt-1 flex gap-1">
										{vendor.methods.map((method) => (
											<Badge key={method} tone="outline">
												{method}
											</Badge>
										))}
									</span>
								</span>
							</div>
						))}
					</div>
					<div className="mt-3 flex items-center gap-2 rounded-[6px] border border-dashed border-white/[0.12] px-3 py-2 text-[11px] leading-[15px] text-faint">
						<span className="icon-[lucide--search] size-[13px] shrink-0" />
						<span className="min-w-0 flex-1 truncate">
							想找的厂商不在上面？都支持：搜索厂商、或直接填一个 OpenAI 兼容地址
						</span>
						<span className="shrink-0 text-muted">自定义服务商</span>
					</div>
				</Modal>
			}
		>
			<ModelCenter />
		</Window>
	);
}
