/**
 * 设计稿的唯一事实源。每条都对应代码里的一个可观察行为，不写代码没有的字段：
 * 没有余额、没有 OAuth 到期时间、没有"仅分类器"开关（由域名推导，只读）。
 */

export type ProviderState = "on" | "off" | "warn";

export type QuotaWindow = { label: string; short: string; used: number; reset: string };

export type Provider = {
	id: string;
	brand:
		| "magpie"
		| "anthropic"
		| "openai"
		| "deepseek"
		| "gemini"
		| "zhipu"
		| "kimi"
		| "xai"
		| "qwen"
		| "mistral"
		| "ollama"
		| "openrouter"
		| "minimax";
	/** 厂商分组：同一厂商有多条（多账号 / 多 Key）时列表出现分组标题 */
	vendorId: string;
	vendorLabel: string;
	name: string;
	detail: string;
	models: number;
	state: ProviderState;
	/** 预设：应用已知地址与密钥，启用时要先拉通模型才落盘 */
	preset?: boolean;
	tag?: "订阅";
	apiKind?: string;
	importedFrom?: string;
	/** 仅用于分类判断，不进模型选择器 */
	classifier?: boolean;
	quota?: QuotaWindow[];
	/** 这一行正在进行的模型刷新（ProviderFetchStatus 的可视化） */
	fetch?: { text: string; kind: "pending" | "done" | "error" };
};

/**
 * 9 条已配置服务商。7 条进这一屏，智谱与类型安全在「查看全部」之后。
 * 合计 43 个可用模型（停用条目不计数）。
 */
export const providers: Provider[] = [
	{
		id: "magpie",
		brand: "magpie",
		vendorId: "magpie",
		vendorLabel: "Magpie",
		name: "Magpie",
		detail: "127.0.0.1:3425 · 本机代理",
		models: 13,
		state: "on",
		preset: true,
	},
	{
		id: "chatgpt-yfdl",
		brand: "openai",
		vendorId: "chatgpt",
		vendorLabel: "ChatGPT",
		name: "yfdl@…",
		detail: "PRO · OAuth 订阅",
		models: 4,
		state: "on",
		tag: "订阅",
		quota: [{ label: "每周窗口", short: "周", used: 62, reset: "周三重置" }],
	},
	{
		id: "chatgpt-team",
		brand: "openai",
		vendorId: "chatgpt",
		vendorLabel: "ChatGPT",
		name: "team@…",
		detail: "PRO · OAuth 订阅",
		models: 4,
		state: "on",
		tag: "订阅",
		quota: [{ label: "5 小时窗口", short: "5h", used: 38, reset: "2h 14m 后重置" }],
	},
	{
		id: "anthropic",
		brand: "anthropic",
		vendorId: "anthropic",
		vendorLabel: "Anthropic",
		name: "Claude",
		detail: "api.anthropic.com",
		models: 6,
		state: "on",
		apiKind: "anthropic-messages",
	},
	{
		id: "deepseek",
		brand: "deepseek",
		vendorId: "deepseek",
		vendorLabel: "DeepSeek",
		name: "DeepSeek",
		detail: "api.deepseek.com",
		models: 2,
		state: "on",
		apiKind: "openai-completions",
	},
	{
		id: "openrouter",
		brand: "openrouter",
		vendorId: "openrouter",
		vendorLabel: "OpenRouter",
		name: "OpenRouter",
		detail: "openrouter.ai",
		models: 7,
		state: "on",
		apiKind: "openai-completions",
		importedFrom: "Claude Code",
	},
	{
		id: "kimi",
		brand: "kimi",
		vendorId: "moonshot",
		vendorLabel: "Moonshot",
		name: "Kimi",
		detail: "api.moonshot.cn",
		models: 2,
		state: "warn",
		apiKind: "openai-completions",
	},
	{
		id: "zhipu",
		brand: "zhipu",
		vendorId: "zhipu",
		vendorLabel: "智谱",
		name: "智谱 GLM",
		detail: "open.bigmodel.cn",
		models: 8,
		state: "off",
		apiKind: "openai-completions",
	},
	{
		id: "typesafe",
		brand: "anthropic",
		vendorId: "typesafe",
		vendorLabel: "TypeSafe",
		name: "类型安全",
		detail: "api.typesafe.ai",
		models: 3,
		state: "off",
		classifier: true,
	},
];

export const providerTotal = providers.length;
/** 停用条目不计数：它的模型不会出现在选择器里。 */
export const enabledProviderCount = providers.filter((p) => p.state !== "off").length;
export const modelCount = providers
	.filter((p) => p.state !== "off")
	.reduce((sum, p) => sum + p.models, 0);

/** 这一屏能放下的 7 行；其余进「查看全部」。 */
export const visibleProviders = providers.slice(0, 7);
export const foldedProviderCount = providerTotal - visibleProviders.length;

export type ProviderGroup = { vendorId: string; label: string; items: Provider[] };

/** 同厂商多条才有分组标题；单条交给品牌标识别，少一层刻度。 */
export function groupProviderRows(items: Provider[]): ProviderGroup[] {
	const groups: ProviderGroup[] = [];
	for (const provider of items) {
		const group = groups.find((entry) => entry.vendorId === provider.vendorId);
		if (group) group.items.push(provider);
		else
			groups.push({ vendorId: provider.vendorId, label: provider.vendorLabel, items: [provider] });
	}
	return groups;
}

/** 兼容旧引用：整表分组。 */
export const providerGroups = groupProviderRows(providers);

/** 刷新结束后的同一份列表：逐行写结果，失败的行留错误文案（没有单独重试动作）。 */
export const providersRefreshing: Provider[] = visibleProviders.map((provider) => {
	if (provider.id === "openrouter") {
		return { ...provider, state: "warn", fetch: { text: "刷新失败：429 限流", kind: "error" } };
	}
	if (provider.id === "kimi") {
		return { ...provider, state: "on", fetch: { text: "已更新 2 个模型", kind: "done" } };
	}
	return { ...provider, fetch: { text: `已更新 ${provider.models} 个模型`, kind: "done" } };
});

/** 路由三档：只有虚拟模型有 fallbacks；默认对话不可用时是自动改选并提示，代审不回退。 */
export type Route = {
	role: string;
	note: string;
	model: string;
	provider: string;
	context: string;
	constraint: string;
	/** 选中项不可用时的真实行为 */
	whenUnavailable: string;
	unset?: boolean;
};

export const routes: Route[] = [
	{
		role: "默认对话",
		note: "新会话，以及未指定模型的请求",
		model: "gpt-6.1-sol",
		provider: "ChatGPT 订阅",
		context: "200K",
		constraint: "6 档推理",
		whenUnavailable: "自动改选并提示",
	},
	{
		role: "标题与摘要",
		note: "会话标题、历史摘要",
		model: "deepseek-v41-flash",
		provider: "DeepSeek",
		context: "128K",
		constraint: "固定不推理",
		whenUnavailable: "回落到默认对话",
	},
	{
		role: "代审",
		note: "危险命令的二次判断",
		model: "",
		provider: "",
		context: "",
		constraint: "需先选模型",
		whenUnavailable: "不回退",
		unset: true,
	},
];

export const virtualModels = [
	{
		id: "magpie/3sbqs/Deepseek-v4.1-flash-02",
		note: "调研 · 批量阅读",
		primary: "gpt-6.1-sol",
		fast: "deepseek-v41-flash",
		fallbacks: 3,
	},
	{
		id: "magpie/gonshi/gpt-6.1-sol",
		note: "评审 · 根因排查",
		primary: "gpt-6.1-sol",
		fast: "—",
		fallbacks: 2,
	},
	{
		id: "magpie/dumate/deepseek-v41-flash",
		note: "界面改动",
		primary: "deepseek-v41-flash",
		fast: "—",
		fallbacks: 0,
	},
];

/** 单张虚拟模型的全部字段（对应 VirtualModelEntry）。 */
export const virtualModelDetail = {
	name: "Auto",
	primary: { model: "gpt-6.1-sol", provider: "ChatGPT 订阅", context: "200K" },
	fast: { model: "deepseek-v41-flash", provider: "DeepSeek", context: "128K" },
	fallbacks: [
		{ model: "qwen4-max", provider: "OpenRouter", context: "256K" },
		{ model: "deepseek-v41-flash", provider: "DeepSeek", context: "128K" },
	],
	classifier: "快模型裁判",
	timeout: "1.2",
};

/** 设置窗口的 16 个分类：没有二级分组，顺序与真实窗口一致。 */
export const navItems = [
	{ label: "通用", icon: "icon-[lucide--sliders-horizontal]" },
	{ label: "快捷键", icon: "icon-[lucide--keyboard]" },
	{ label: "语音输入", icon: "icon-[lucide--mic]" },
	{ label: "外观", icon: "icon-[lucide--palette]", to: "/appearance" },
	{ label: "模型中心", icon: "icon-[lucide--server]", to: "/" },
	{ label: "子代理类型", icon: "icon-[lucide--bot]", to: "/agent-types" },
	{ label: "内置工具", icon: "icon-[lucide--wrench]" },
	{ label: "工作流", icon: "icon-[lucide--workflow]" },
	{ label: "技能", icon: "icon-[lucide--sparkles]" },
	{ label: "Claude Code 插件", icon: "icon-[lucide--puzzle]" },
	{ label: "MCP 服务器", icon: "icon-[lucide--plug]" },
	{ label: "指令文件", icon: "icon-[lucide--file-text]" },
	{ label: "设备", icon: "icon-[lucide--smartphone]" },
	{ label: "SSH", icon: "icon-[lucide--terminal]" },
	{ label: "用量", icon: "icon-[lucide--chart-column]" },
	{ label: "资源", icon: "icon-[lucide--gauge]" },
];

/** 「允许子代理指定模型」的条目：模型 + 推理档 + 给主 agent 的选型说明。 */
export const subagentModels = [
	{
		model: "Deepseek-v4.1-flash-02",
		provider: "OpenRouter",
		thinking: "最高",
		note: "用于 scout 只读调研、大量读代码/文档、日志与搜索结果总结等不需深度推理的子任务。",
		enabled: true,
	},
	{
		model: "GPT-6.1 Sol",
		provider: "ChatGPT 订阅",
		thinking: "极高",
		note: "用于 reviewer 代码评审、架构设计/方案权衡、疑难 bug 与根因排查；推理最强但成本最高。",
		enabled: true,
	},
	{
		model: "GPT-6.1 Sol",
		provider: "ChatGPT 订阅",
		thinking: "极高",
		note: "用于 worker 功能实现、重构、按既定方案改代码，以及 tester 编写和修复测试。",
		enabled: true,
	},
	{
		model: "deepseek-v41-flash",
		provider: "DeepSeek",
		thinking: "高",
		note: "用于 designer 软件项目 ui 界面的改动。",
		enabled: false,
	},
];

export type AgentTypeRow = {
	name: string;
	description: string;
	badges: string[];
	/** 第三行：派发方式，或固定模型的 provider / model */
	pickedBy: string;
	state?: "locked" | "on" | "off";
	actions?: "edit" | "edit-delete";
};

/** 类型清单：CodeKiln 锁定，general 固定跟随，其余内置可开关，自定义可增删改。 */
export const agentTypes: AgentTypeRow[] = [
	{
		name: "CodeKiln",
		description: "继承当前对话模型，并提供产品能力",
		badges: ["系统", "已锁定"],
		pickedBy: "由系统提供，不可修改或停用",
		state: "locked",
	},
	{
		name: "general",
		description: "跟随会话模型，全部工具",
		badges: ["内置"],
		pickedBy: "跟随会话模型",
		state: "on",
	},
	{
		name: "scout",
		description: "Fast read-only recon; returns compressed findings",
		badges: ["内置", "只读"],
		pickedBy: "由主 Agent 选择",
		state: "on",
		actions: "edit",
	},
	{
		name: "worker",
		description: "Implements a self-contained coding subtask end to end",
		badges: ["内置"],
		pickedBy: "由主 Agent 选择",
		state: "on",
		actions: "edit",
	},
	{
		name: "reviewer",
		description: "Reviews code or diffs; read-only, returns prioritized issues",
		badges: ["内置", "只读"],
		pickedBy: "由主 Agent 选择",
		state: "on",
		actions: "edit",
	},
	{
		name: "tester",
		description:
			"Writes failing tests first (TDD RED); can only write test files, never implementation",
		badges: ["内置"],
		pickedBy: "由主 Agent 选择",
		state: "on",
		actions: "edit",
	},
	{
		name: "designer",
		description:
			"Creates standalone UI mockups, posters, and slides on the design canvas; not for front-end implementation",
		badges: ["内置"],
		pickedBy: "由主 Agent 选择",
		state: "off",
		actions: "edit",
	},
	{
		name: "kdocs-writer",
		description: "按 kdocs 模板写文档",
		badges: ["自定义"],
		pickedBy: "OpenRouter / deepseek-v41-flash · 思考 高",
		state: "on",
		actions: "edit-delete",
	},
];

/** 类型编辑对话框的初值：编辑内置 scout 时预填的内容。 */
export const agentTypeDraft = {
	name: "scout",
	description: "快速只读侦察，返回压缩后的结论",
	systemPrompt:
		"You are a fast reconnaissance agent. Read and search only — never modify files or run commands with side effects.\n" +
		"Return a compact, well-structured report of findings with concrete file paths.\n\n" +
		"Working rules:\n" +
		"1. Start from the smallest set of files that can answer the question; widen only when a symbol is re-exported.\n" +
		"2. Quote file:line for every claim. If two sources disagree, say so instead of picking one.\n" +
		"3. Never print whole files — compress to the lines that matter, then list what you skipped.\n" +
		"4. Stop when the question is answered; do not start adjacent investigations.",
	modelMode: "主 agent 挑选",
	toolset: "只读",
};

export const skillChoices = [
	{ name: "project-knowledge", source: "内置", note: "项目知识检索与沉淀", checked: true },
	{ name: "enso-cdp", source: "内置", note: "真机 CDP 验证", checked: true },
	{ name: "vetta-ui-design", source: "插件", note: "设计画布与 .vetd 规范", checked: false },
	{ name: "browser-use", source: "插件", note: "浏览器自动化", checked: false },
];

export const mcpChoices = [
	{ name: "exa-websearch", transport: "http", note: "网页搜索与抓取", checked: true },
	{ name: "filesystem", transport: "stdio", note: "工作区文件读写", checked: false },
];

/** 本机导入：扫描到的候选按应用分组，重复的默认不勾选。 */
export type ImportCandidate = {
	id: string;
	name: string;
	baseUrl: string;
	models: number;
	duplicate: boolean;
	checked: boolean;
};

export const importApps: Array<{
	app: string;
	mark: "claude" | "cherry" | "ensoai" | "codex";
	path: string;
	candidates: ImportCandidate[];
}> = [
	{
		app: "Claude Code",
		mark: "claude",
		path: "~/.claude/settings.json",
		candidates: [
			{
				id: "cc-groq",
				name: "Groq",
				baseUrl: "api.groq.com",
				models: 4,
				duplicate: false,
				checked: true,
			},
			{
				id: "cc-openrouter",
				name: "OpenRouter",
				baseUrl: "openrouter.ai",
				models: 7,
				duplicate: true,
				checked: false,
			},
		],
	},
	{
		app: "Cherry Studio",
		mark: "cherry",
		path: "~/Library/Application Support/CherryStudio",
		candidates: [
			{
				id: "cherry-deepseek",
				name: "DeepSeek",
				baseUrl: "api.deepseek.com",
				models: 2,
				duplicate: true,
				checked: false,
			},
		],
	},
	{
		app: "EnsoAI",
		mark: "ensoai",
		path: "~/.ensoai/config.json",
		candidates: [
			{
				id: "ensoai-qwen",
				name: "通义千问",
				baseUrl: "dashscope.aliyuncs.com",
				models: 5,
				duplicate: false,
				checked: false,
			},
		],
	},
];

/** 订阅账号：key / 邮箱 / 档位 / 额度 / 是否已登出。 */
export type SubscriptionAccount = {
	key: string;
	email: string;
	plan: string;
	enabled: boolean;
	signedIn: boolean;
	quota: QuotaWindow[];
};

export const subscriptionAccounts: SubscriptionAccount[] = [
	{
		key: "openai",
		email: "yfdl@…",
		plan: "PRO",
		enabled: true,
		signedIn: true,
		quota: [
			{ label: "5 小时窗口", short: "5h", used: 38, reset: "2h 14m 后重置" },
			{ label: "每周窗口", short: "周", used: 62, reset: "周三重置" },
		],
	},
	{
		key: "openai#2",
		email: "team@…",
		plan: "PRO",
		enabled: true,
		signedIn: true,
		quota: [{ label: "每周窗口", short: "周", used: 18, reset: "周三重置" }],
	},
	{
		key: "openai#3",
		email: "lab@…",
		plan: "PRO",
		enabled: false,
		signedIn: false,
		quota: [],
	},
];

/** 账号池成员：池按顺序使用"已启用且已登录"的账号。 */
export const poolMembers = [
	{ email: "yfdl@…", plan: "PRO", enabled: true, signedIn: true, selected: true },
	{ email: "team@…", plan: "PRO", enabled: true, signedIn: true, selected: true },
	{ email: "lab@…", plan: "PRO", enabled: false, signedIn: false, selected: false },
];

/** API Key 型服务商的详情（抽屉与编辑页共用）。 */
export const apiKeyDetail = {
	name: "OpenRouter",
	baseUrl: "openrouter.ai/api/v1",
	key: "sk-or-v1-…9f4c",
	apiKind: "openai-completions",
	importedFrom: "Claude Code",
	models: 7,
	enabledModels: 6,
	lastRefresh: "12:04",
	failedModel: { id: "anthropic/claude-opus-5", error: "upstream 429" },
};

/** 模型清单：Default / Overridden / Catalog 三种覆盖来源。 */
export type RosterRow = {
	id: string;
	badge: "default" | "overridden" | "catalog";
	enabled: boolean;
	reasoning?: "on" | "off";
	thinking?: string;
	context?: string;
	maxTokens?: string;
};

export const modelRoster: RosterRow[] = [
	{ id: "deepseek/deepseek-v4.1-flash", badge: "default", enabled: true },
	{ id: "openai/gpt-6.1-sol", badge: "default", enabled: true },
	{
		id: "anthropic/claude-sonnet-4.6",
		badge: "overridden",
		enabled: true,
		reasoning: "on",
		thinking: "高",
		context: "200K",
		maxTokens: "64K",
	},
	{ id: "google/gemini-3.0-pro", badge: "catalog", enabled: true, context: "1M" },
	{ id: "x-ai/grok-5", badge: "default", enabled: false },
	{ id: "mistral/mistral-large-3", badge: "default", enabled: true },
	{ id: "qwen/qwen4-max", badge: "default", enabled: true, context: "256K" },
];

/** 预设（Magpie）：地址可改端口，模型清单是快照。 */
export const presetDetail = {
	name: "Magpie",
	baseUrl: "127.0.0.1:3425",
	port: "3425",
	models: 13,
	snapshotNote: "模型清单是快照：Magpie 侧删掉的模型不会自动消失，点「刷新模型」才同步",
	catalogNote: "按 catalogId 识别：改名或换地址都还是同一条预设，不会多出一条",
};
