export const frame = { width: 402, height: 874, radius: 62, title: "新建会话" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { Dawn } from "../components/Dawn";
import { LinkPill } from "../components/LinkPill";
import { sessions } from "../components/data";

const projects = ["EnsoCode", "kdocs-bridge", "image-studio"];

// 新建会话：全 app 第二处铺色。两行大字 + 一块大输入卡，项目是胶囊，模型在卡里。
export default function NewSession() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<Dawn />
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<header className="relative flex items-center py-2 pr-4 pl-1">
				<Link
					to="/sessions"
					aria-label="关闭"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--x] size-6" />
				</Link>
				<div className="flex-1" />
				<LinkPill label="书房 · 已连接" />
			</header>
			<div className="relative px-5 pt-7">
				<h1 className="text-[30px] leading-[37px] font-bold tracking-[-0.02em]">
					早上好
					<br />
					<span className="bg-gradient-to-r from-greet-a to-greet-b bg-clip-text text-transparent">
						今天做点什么
					</span>
				</h1>
				<p className="mt-3 text-[14px] leading-5 text-dim">选一个项目，然后说清楚你要的结果。</p>
			</div>
			<div className="relative mt-4 flex gap-2 overflow-hidden px-5">
				{projects.map((p, i) => (
					<span
						key={p}
						className={`flex h-9 shrink-0 items-center rounded-full px-4 text-[14px] leading-5 font-medium ${
							i === 0 ? "bg-pill text-pill-ink" : "bg-card text-ink2"
						}`}
					>
						{p}
					</span>
				))}
			</div>
			<div className="relative mt-4 px-4">
				<div className="rounded-[24px] bg-card p-4 shadow-[0_18px_40px_-24px_rgb(0_0_0/0.35)]">
					<p className="min-h-[86px] text-[16px] leading-[24px] text-dim">
						描述要它做的事。可以带文件、截图，或者直接说「修好刚才那个测试」。
					</p>
					<div className="mt-2 flex items-center gap-2">
						<button
							aria-label="添加附件"
							className="flex size-10 items-center justify-center rounded-full bg-card2 text-ink"
						>
							<span className="icon-[lucide--plus] size-5" />
						</button>
						<Link
							to="/config"
							className="flex h-10 items-center gap-1.5 rounded-full bg-card2 px-3 text-[13px] leading-4 font-medium"
						>
							<span className="icon-[lucide--sparkles] size-4" />
							Sonnet 4.6
							<span className="text-dim">· 思考 高</span>
							<span className="icon-[lucide--chevron-down] size-3.5 text-faint" />
						</Link>
						<div className="flex-1" />
						<button
							aria-label="开始"
							className="flex size-12 items-center justify-center rounded-full bg-pill text-pill-ink"
						>
							<span className="icon-[lucide--arrow-up] size-[22px]" />
						</button>
					</div>
				</div>
			</div>
			<div className="relative mt-6 min-h-0 flex-1 px-5">
				<div className="flex items-center gap-2 pb-1">
					<span className="text-[13px] leading-[18px] font-medium text-dim">接着上次</span>
					<div className="flex-1" />
					<span className="text-[11px] leading-4 text-faint">2 个</span>
				</div>
				{sessions.slice(0, 2).map((s) => (
					<Link
						key={s.id}
						to="/chat"
						className="flex items-center gap-2 py-2.5"
					>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[15px] leading-[21px] font-medium">{s.title}</p>
							<p className="truncate text-[13px] leading-[18px] text-dim">
								{s.project} · {s.note}
							</p>
						</div>
						<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
					</Link>
				))}
			</div>
		</div>
	);
}
