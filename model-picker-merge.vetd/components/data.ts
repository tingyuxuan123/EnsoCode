import type { Level, PickerGroup, RailEntry } from "./ModelPickerPanel";

/** 条目（账号 / 网关）——一级只保留"切到哪个来源"，不再当一步"先选账号" */
export const RAIL: RailEntry[] = [
	{ key: "devin", label: "Devin · 1940203983@qq.com", mark: "D" },
	{ key: "magpie", label: "自定义 · magpie 127.0.0.1", mark: "M" },
	{ key: "virtual", label: "虚拟模型", mark: "", icon: "icon-[lucide--shuffle]" },
];

/**
 * magpie 网关后面挂着多个上游，同一模型名会重复出现；
 * 第二行的 `上游/模型` 就是为这种重名准备的（数据取自本机截图里的真实条目）。
 */
export const MAGPIE_GROUP: PickerGroup = {
	vendor: "自定义",
	meta: "magpie · 127.0.0.1",
	models: [
		{ name: "GPT-6.2 Sol", id: "auto/gpt-6.2-sol", window: "1M", selected: true },
		{ name: "GPT-6.2 Astra", id: "auto/gpt-6.2-astra", window: "1M" },
		{ name: "GPT-6.1 Sol", id: "gonshi/gpt-6.1-sol", window: "922K" },
		{ name: "GPT-6.1 Sol", id: "auto/gpt-6.1-sol", window: "1M" },
		{ name: "DeepSeek V4.1 Flash", id: "catpaw/deepseek-v4.1-flash", window: "1M" },
		{ name: "DeepSeek-V4.1-Flash", id: "dumate/deepseek-v41-flash", window: "1M" },
		{ name: "glm-53", id: "dumate/glm-53", window: "1M" },
	],
};

export const DEVIN_GROUP: PickerGroup = {
	vendor: "Devin",
	meta: "1940203983@qq.com",
	badge: "Free",
	models: [
		{ name: "GPT-6.2 Sol", id: "gpt-6.2-sol", window: "1M" },
		{ name: "GPT-6.2 Astra", id: "gpt-6.2-astra", window: "1M" },
		{ name: "GPT-6.1 Sol", id: "gpt-6.1-sol", window: "922K" },
	],
};

/** 搜索态：跨条目平铺，副标题补上条目名，重名模型才分得清 */
export const SEARCH_GROUP: PickerGroup = {
	vendor: "搜索",
	models: [
		{ name: "GPT-6.2 Sol", id: "magpie/auto/gpt-6.2-sol", window: "1M", selected: true },
		{ name: "GPT-6.1 Sol", id: "magpie/gonshi/gpt-6.1-sol", window: "922K" },
		{ name: "GPT-6.1 Sol", id: "magpie/auto/gpt-6.1-sol", window: "1M" },
		{ name: "GPT-6.2 Sol", id: "devin/gpt-6.2-sol", window: "1M" },
		{ name: "GPT-6.1 Sol", id: "devin/gpt-6.1-sol", window: "922K" },
	],
};

export const LEVELS: Level[] = ["低", "中", "高", "极高", "最高"];
