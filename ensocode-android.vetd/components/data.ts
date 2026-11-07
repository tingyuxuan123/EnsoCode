export type Status = "waiting" | "running" | "error" | "done" | "idle";

export interface Session {
	id: string;
	title: string;
	/** 没有项目的是“对话” */
	project?: string;
	time: string;
	status: Status;
	pinned?: boolean;
}

export const computer = "tingyu 的 MacBook Pro";
export const model = "Claude Opus 5.5";
export const thinking = "高";

export const sessions: Session[] = [
	{ id: "s1", title: "会话恢复后时间线为空", project: "EnsoCode", time: "刚刚", status: "waiting", pinned: true },
	{ id: "s2", title: "工作流面板显示运行进度", project: "EnsoCode", time: "2 分钟前", status: "running" },
	{ id: "s3", title: "Windows 版 CI 签名失败排查", project: "EnsoCode", time: "6 分钟前", status: "running" },
	{ id: "s4", title: "首页 Hero 换成浅色截图", project: "ensocode-site", time: "18 分钟前", status: "error" },
	{ id: "s5", title: "子代理报告被截断", project: "EnsoCode", time: "1 小时前", status: "done" },
	{ id: "s6", title: "解释 apply_patch 的格式", time: "2 小时前", status: "done" },
	{ id: "s7", title: "MCP env 明文只保留在 Main", project: "EnsoCode", time: "昨天", status: "done" },
	{ id: "s8", title: "终端主题跟随桌面同步", project: "pi-extensions", time: "昨天", status: "idle" },
	{ id: "s9", title: "发布 personal-v0.9.4", project: "EnsoCode", time: "周三", status: "done" },
];
