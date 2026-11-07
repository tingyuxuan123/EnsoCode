export const frame = { width: 412, height: 915, title: "新任务" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { AgentAvatar } from "../components/Enso";
import { SessionMeta } from "../components/SessionMeta";
import { StatusGlyph } from "../components/StatusGlyph";
import { TopBar } from "../components/TopBar";
import { model, sessions, thinking } from "../components/data";

/** 新任务（NewSessionScreen）：左上晨光、两行大字问候，下方是等你的任务，最底下是输入框。 */
export default function NewTask() {
	const waiting = sessions.filter((s) => s.status === "waiting");
	const running = sessions.filter((s) => s.status === "running");
	const glance = [...waiting, ...running].slice(0, 3);
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<div
				className="pointer-events-none absolute inset-x-0 top-0 h-[560px]"
				style={{
					background:
						"radial-gradient(90% 62% at 0% 0%, var(--color-dawn-side) 0%, transparent 70%), radial-gradient(85% 58% at 100% 6%, var(--color-dawn) 0%, transparent 72%)",
				}}
			/>
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/home"
				title="新任务"
				detail={`${model} · ${thinking}`}
				menu
			/>
			<main className="relative flex min-h-0 flex-1 flex-col px-6 pt-5 pb-3">
				<h1 className="text-[34px] leading-[42px] font-semibold tracking-[-0.01em]">
					<span className="block">下午好，tingyu</span>
					<span className="block bg-gradient-to-r from-greet-a to-greet-b bg-clip-text text-transparent">
						今天让它做点什么？
					</span>
				</h1>
				<button className="glass mt-5 flex h-10 items-center gap-1.5 self-start rounded-full px-3.5 text-[14px] font-medium">
					<span className="icon-[lucide--folder] size-4" />
					EnsoCode
					<span className="icon-[lucide--chevrons-up-down] size-3.5 text-dim" />
				</button>
				<div className="flex-1" />
				<section className="glass overflow-hidden rounded-[26px]">
					<div className="flex items-center gap-2.5 pt-3.5 pr-4 pb-1 pl-3.5">
						<AgentAvatar
							size={24}
							working
						/>
						<h2 className="text-[15px] leading-5 font-semibold">任务看板</h2>
					</div>
					{glance.map((s, i) => (
						<Link
							key={s.id}
							to="/session"
							className={`flex items-center gap-3 px-4 py-3 ${
								s.status === "waiting" ? "bg-yellow/[0.09]" : ""
							} ${i > 0 ? "shadow-[inset_0_0.75px_0_var(--color-line)]" : ""}`}
						>
							<div className="min-w-0 flex-1">
								<div className="truncate text-[15px] leading-5 font-medium">{s.title}</div>
								<SessionMeta
									project={s.project}
									time={s.time}
								/>
							</div>
							<StatusGlyph
								status={s.status}
								size={16}
							/>
						</Link>
					))}
					<Link
						to="/board"
						className="mx-4 flex items-center gap-2 py-3 text-[15px] leading-5 text-ink2 shadow-[inset_0_0.75px_0_var(--color-line)]"
					>
						<span className="flex-1">还有 4 个 · 查看全部</span>
						<span className="icon-[lucide--chevron-right] size-[18px]" />
					</Link>
				</section>
			</main>
			<Composer placeholder="描述任务，@ 引用文件，/ 用技能" />
		</div>
	);
}
