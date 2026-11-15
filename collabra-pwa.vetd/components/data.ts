import type { Status } from "./StatusGlyph";

export const computer = "书房 · MacBook Pro";
export const model = "Sonnet 4.6 · 思考 高";

export const sessions: {
	id: string;
	title: string;
	project: string;
	time: string;
	status: Status;
	note: string;
	pinned?: boolean;
}[] = [
	{
		id: "timeline",
		title: "恢复会话后时间线为空",
		project: "EnsoCode",
		time: "3 分钟",
		status: "running",
		note: "正在跑测试",
		pinned: true,
	},
	{
		id: "pwa",
		title: "PWA 重设计：黑白 + 玻璃",
		project: "EnsoCode",
		time: "现在",
		status: "waiting",
		note: "等一条命令批准",
	},
	{
		id: "kdocs",
		title: "kdocs 插件签名校验失败",
		project: "kdocs-bridge",
		time: "18 分钟",
		status: "error",
		note: "上一步失败",
	},
	{
		id: "export",
		title: "广告素材批量导出",
		project: "image-studio",
		time: "1 小时",
		status: "done",
		note: "已交付 12 张",
	},
	{
		id: "vectors",
		title: "补 pair 协议的向量测试",
		project: "EnsoCode",
		time: "昨天",
		status: "idle",
		note: "空闲",
	},
	{
		id: "week43",
		title: "第 43 周排期",
		project: "群聊",
		time: "昨天",
		status: "waiting",
		note: "2 条待处理",
	},
	{
		id: "export-json",
		title: "会话导出 JSON 格式",
		project: "EnsoCode",
		time: "昨天",
		status: "done",
		note: "已交付",
	},
	{
		id: "narrow",
		title: "权限弹窗在窄屏被裁",
		project: "EnsoCode",
		time: "2 天",
		status: "idle",
		note: "空闲",
	},
];

export const members: { name: string; role: string; status: Status; note: string }[] = [
	{ name: "林经理", role: "项目经理", status: "waiting", note: "1 条待处理" },
	{ name: "阿全", role: "全栈", status: "running", note: "正在验 #6 的部署" },
	{ name: "小设", role: "设计", status: "done", note: "刚交了第一版" },
	{ name: "小测", role: "测试", status: "idle", note: "等这次部署稳定" },
	{ name: "小雪", role: "全栈", status: "idle", note: "空闲 20 分钟" },
];
