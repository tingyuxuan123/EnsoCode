export const frame = { width: 412, height: 915, title: "会话菜单" };

import { Link } from "react-router";
import { Sheet } from "../components/Sheet";
import Session from "./session";

const stats = [
	{ label: "总用量", value: "1.25M", unit: "tokens" },
	{ label: "缓存命中", value: "81", unit: "%" },
	{ label: "输出速度", value: "42", unit: "tok/s" },
];

const actions = [
	{ to: "/goal-set", icon: "icon-[lucide--target]", title: "设定目标", detail: "让它自己推进到达成" },
	{ to: "/rewind", icon: "icon-[lucide--undo-2]", title: "回退到某条消息", detail: "可同时恢复文件" },
	{ to: "/session", icon: "icon-[lucide--shrink]", title: "压缩上下文", detail: "前面的对话总结成摘要" },
	{ to: "/session", icon: "icon-[lucide--rotate-ccw]", title: "重试上一轮", detail: "" },
	{ to: "/changes", icon: "icon-[lucide--file-diff]", title: "查看改动", detail: "2 个文件 +38 −6" },
	{ to: "/preview", icon: "icon-[lucide--globe]", title: "网页预览", detail: "localhost:5173" },
	{ to: "/tasks", icon: "icon-[lucide--layers]", title: "后台与协作", detail: "子代理、后台任务" },
];

/** 会话右上角「⋮」：上下文和用量在最上面，下面是对这个会话能做的事。 */
export default function SessionMenu() {
	return (
		<div className="relative h-full overflow-hidden">
			<Session />
			<Sheet
				backTo="/session"
				title="会话恢复后时间线为空"
			>
				<section className="mx-3 rounded-[20px] bg-card px-4 pt-3.5 pb-4">
					<div className="flex items-baseline gap-2">
						<span className="text-[13px] leading-[18px] font-medium text-dim">上下文</span>
						<span className="ml-auto text-[13px] leading-[18px] text-dim tabular-nums">76K / 200K</span>
					</div>
					<div className="mt-1 text-[34px] leading-[40px] font-semibold tabular-nums">
						38<span className="text-[20px] font-medium text-dim">%</span>
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card2">
						<div className="h-full w-[38%] rounded-full bg-ink" />
					</div>
					<div className="mt-4 grid grid-cols-3 gap-3">
						{stats.map((s) => (
							<div key={s.label}>
								<div className="text-[12px] leading-4 text-dim">{s.label}</div>
								<div className="mt-0.5 text-[17px] leading-6 font-semibold tabular-nums">
									{s.value}
									<span className="ml-0.5 text-[12px] font-normal text-dim">{s.unit}</span>
								</div>
							</div>
						))}
					</div>
				</section>
				<nav className="mt-3 px-1">
					{actions.map((a) => (
						<Link
							key={a.title}
							to={a.to}
							className="flex items-center gap-3.5 px-5 py-3"
						>
							<span className={`${a.icon} size-[22px] shrink-0`} />
							<span className="shrink-0 text-[16px] leading-[22px] font-medium whitespace-nowrap">{a.title}</span>
							<span className="min-w-0 flex-1 truncate text-right text-[13px] leading-[18px] text-dim tabular-nums">{a.detail}</span>
						</Link>
					))}
				</nav>
			</Sheet>
		</div>
	);
}
