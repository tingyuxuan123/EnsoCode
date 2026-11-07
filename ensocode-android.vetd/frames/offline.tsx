export const frame = { width: 412, height: 915, title: "电脑离线" };

import { StatusBar } from "@vetta/ios";
import { Enso } from "../components/Enso";
import { Dawn } from "../components/HomeChrome";
import { LinkPill } from "../components/LinkPill";
import { SessionMeta } from "../components/SessionMeta";
import { TopBar } from "../components/TopBar";
import { computer, model, sessions, thinking } from "../components/data";

/**
 * 电脑离线：缓存的任务照常可看，但发不出去，所以输入框的位置换成连接胶囊。
 * 头像睡着了，看板摘要褪成六成透明并写明上次同步时间。
 */
export default function Offline() {
	const kept = sessions.filter((s) => s.status === "waiting" || s.status === "running").slice(0, 3);
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<Dawn />
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/home"
				title="新任务"
				detail={`${model} · ${thinking}`}
			/>
			<main className="relative flex min-h-0 flex-1 flex-col px-6 pt-5 pb-3">
				<span className="flex size-10 items-center justify-center rounded-full bg-card text-faint">
					<Enso size={22} />
				</span>
				<h1 className="mt-5 text-[34px] leading-[42px] font-semibold tracking-[-0.01em]">
					<span className="block">电脑睡着了</span>
					<span className="block text-dim">任务都还在</span>
				</h1>
				<p className="mt-4 text-[15px] leading-[22px] text-ink2">
					{computer} 没有响应，可能合上了盖子或断了网。保持 EnsoCode 开着，它醒来后这里会自动重连。
				</p>
				<div className="flex-1" />
				<section className="glass overflow-hidden rounded-[26px] opacity-60">
					<div className="flex items-center gap-2 pt-3.5 pr-4 pb-1 pl-4">
						<h2 className="flex-1 text-[15px] leading-5 font-semibold">任务看板</h2>
						<span className="text-[12px] leading-4 text-dim">上次同步 14:02</span>
					</div>
					{kept.map((s, i) => (
						<div
							key={s.id}
							className={`px-4 py-3 ${i > 0 ? "shadow-[inset_0_0.75px_0_var(--color-line)]" : ""}`}
						>
							<div className="truncate text-[15px] leading-5 font-medium">{s.title}</div>
							<SessionMeta
								project={s.project}
								time={s.time}
							/>
						</div>
					))}
				</section>
			</main>
			<div className="flex flex-col items-center gap-3 px-6 pt-3 pb-10">
				<LinkPill online={false} />
				<button className="glass-ink flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium">
					<span className="icon-[lucide--refresh-cw] size-[18px]" />
					重新连接
				</button>
			</div>
		</div>
	);
}
