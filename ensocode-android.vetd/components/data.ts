export type Status = "waiting" | "running" | "error" | "done" | "idle";

export interface Session {
	id: string;
	title: string;
	/** 没有项目的是“对话” */
	project?: string;
	time: string;
	status: Status;
	pinned?: boolean;
	/** 设计稿里点开去哪一页 */
	to: string;
}

export const computer = "tingyu 的 MacBook Pro";
export const model = "Claude Opus 5.5";
export const thinking = "高";

export const sessions: Session[] = [
	{ id: "s1", title: "会话恢复后时间线为空", project: "EnsoCode", time: "刚刚", status: "waiting", pinned: true, to: "/session" },
	{ id: "s4", title: "首页 Hero 用哪张截图", project: "ensocode-site", time: "4 分钟前", status: "waiting", to: "/ask" },
	{ id: "s2", title: "工作流面板显示运行进度", project: "EnsoCode", time: "2 分钟前", status: "running", to: "/queue" },
	{ id: "s3", title: "Windows 版 CI 签名失败排查", project: "EnsoCode", time: "6 分钟前", status: "running", to: "/goal" },
	{ id: "s8", title: "终端主题跟随桌面同步", project: "pi-extensions", time: "25 分钟前", status: "error", to: "/session" },
	{ id: "s5", title: "子代理报告被截断", project: "EnsoCode", time: "1 小时前", status: "done", to: "/session" },
	{ id: "s6", title: "解释 apply_patch 的格式", time: "2 小时前", status: "done", to: "/session" },
	{ id: "s7", title: "MCP env 明文只保留在 Main", project: "EnsoCode", time: "昨天", status: "done", to: "/session" },
	{ id: "s9", title: "发布 personal-v0.9.4", project: "EnsoCode", time: "周三", status: "done", to: "/session" },
];

export type BotState = "idle" | "running" | "queued";

/** 桌面「成员」里的 bot：名字、职位、头像色（PairBotMember）。 */
export interface Bot {
	id: string;
	name: string;
	title: string;
	color: string;
	status: BotState;
}

export const bots: Record<string, Bot> = {
	lin: { id: "lin", name: "林经理", title: "项目经理", color: "#2f6f5e", status: "running" },
	quan: { id: "quan", name: "阿全", title: "全栈工程师", color: "#c2410c", status: "queued" },
	yun: { id: "yun", name: "老运", title: "运维", color: "#4b5563", status: "idle" },
	ce: { id: "ce", name: "小测", title: "测试", color: "#0e7490", status: "idle" },
	she: { id: "she", name: "小设", title: "设计", color: "#be185d", status: "running" },
};

export const approvalModes = [
	{ id: "supervised", title: "全程审批", detail: "每条命令与文件改动都需确认" },
	{ id: "auto-edits", title: "自动接受编辑", detail: "文件编辑直接执行，命令与 MCP 仍需确认" },
	{ id: "full", title: "完全放行", detail: "所有操作不经确认直接执行" },
	{ id: "assistant", title: "助手代审", detail: "由 DeepSeek V4.1 Flash 先审每一步操作" },
];
