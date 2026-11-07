export const frame = { width: 412, height: 915, title: "会话" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { AgentAvatar } from "../components/Eaves";
import { TopBar } from "../components/TopBar";
import { model } from "../components/data";

function Code({ children }: { children: string }) {
	return <code className="rounded-md bg-card2 px-1.5 py-px font-mono whitespace-nowrap text-[13.5px] text-ink">{children}</code>;
}

/** 会话：对话、折叠的工具步骤、改动摘要；Agent 等你批准时，审批面板顶替输入框。 */
export default function Session() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/home"
				title="会话恢复后时间线为空"
				detail={`Eaves · ${model} · 高`}
				menu
			>
				<Link
					to="/session-menu"
					aria-label="会话菜单"
					className="flex size-10 items-center justify-center rounded-full text-ink2"
				>
					<span className="icon-[mdi--dots-vertical] size-6" />
				</Link>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<p className="pb-4 text-center text-[11px] leading-[14px] text-faint">今天 14:02</p>
				<div className="flex justify-end pb-5 pl-12">
					<p className="rounded-[20px] rounded-br-md bg-pill px-4 py-3 text-[16px] leading-[22px] text-pill-ink">
						恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。
					</p>
				</div>
				<article className="flex flex-col gap-2.5">
					<div className="flex items-center gap-2">
						<AgentAvatar size={22} />
						<span className="text-[15px] leading-5 font-semibold">Eaves</span>
						<span className="text-[12px] leading-4 text-dim">3 分钟前</span>
					</div>
					<button className="flex items-center gap-2 rounded-[14px] bg-card2/60 px-3 py-2.5 text-[14px] leading-5 text-dim">
						<span className="icon-[lucide--circle-check] size-4" />
						<span className="flex-1 text-left">已完成 7 步 · 读了 5 个文件，跑了 1 次测试</span>
						<span className="icon-[lucide--chevron-right] size-4 text-faint" />
					</button>
					<div className="flex flex-col gap-2.5 text-[15px] leading-6 text-ink">
						<p>
							根因在 renderer 的 reducer：恢复时 worker 从 seq 1 重新回放事件，而 store 还留着旧连接的 <Code>lastSeq = 412</Code>
							，回放的事件全被当成过期丢掉了。
						</p>
						<ul className="flex list-disc flex-col gap-1 pl-5 marker:text-faint">
							<li>恢复时用回放的第一个 seq 重置 lastSeq</li>
							<li>新增测试：断开再恢复，时间线条数与 jsonl 一致</li>
						</ul>
					</div>
					<Link
						to="/changes"
						className="flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3"
					>
						<span className="icon-[lucide--file-diff] size-[18px] text-ink2" />
						<span className="flex-1 text-[14px] leading-5 font-medium">改动了 2 个文件</span>
						<span className="font-mono text-[13px] text-green">+38</span>
						<span className="font-mono text-[13px] text-red">−6</span>
						<span className="icon-[lucide--chevron-right] size-4 text-faint" />
					</Link>
					<div className="flex items-center gap-2.5 rounded-2xl bg-card px-3.5 py-3">
						<span className="icon-[lucide--terminal] size-4 text-dim" />
						<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
							bash<span className="text-dim">: pnpm test -- sessionReducer</span>
						</span>
						<span className="rounded-full bg-yellow/15 px-2.5 py-1 text-[11px] leading-[14px] font-medium text-yellow-ink">等你批准</span>
					</div>
				</article>
			</div>
			<section className="glass relative mx-3 mb-7 rounded-[26px] p-4">
				<div className="flex items-center gap-2">
					<span className="icon-[mdi--help] size-[18px] animate-pulse text-yellow" />
					<h2 className="flex-1 text-[15px] leading-5 font-semibold">它想运行一条命令</h2>
					<span className="text-[12px] leading-4 text-dim">全程审批</span>
				</div>
				<div className="mt-3 rounded-[14px] bg-card2 px-3.5 py-3 font-mono text-[14px] leading-5">
					<span className="text-dim">$ </span>
					pnpm test -- sessionReducer
				</div>
				<p className="mt-2 px-0.5 text-[12px] leading-4 text-dim">在 E:\project\EnsoCode 中执行 · 只读，不会改动文件</p>
				<div className="mt-4 flex gap-2.5">
					<button className="glass h-12 flex-1 rounded-full text-[15px] font-medium">拒绝</button>
					<button className="glass-ink flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-full text-[15px] font-medium">
						<span className="icon-[lucide--check] size-5" />
						允许
					</button>
				</div>
				<button className="mt-2 w-full py-2 text-[14px] leading-5 font-medium text-ink2">本会话总是允许</button>
			</section>
		</div>
	);
}
