export const frame = { width: 402, height: 874, radius: 62, title: "Web 预览" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";

// Web 预览：上面是网址和两个动作，下面是会话起的本地页面，只读。
export default function Preview() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/chat"
				title="预览"
				detail="localhost:5174 · 只读"
			>
				<button
					aria-label="刷新"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--rotate-cw] size-[22px]" />
				</button>
				<button
					aria-label="在浏览器打开"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--external-link] size-[22px]" />
				</button>
			</TopBar>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
				<div className="flex items-center gap-2 rounded-t-[18px] bg-card2 px-3.5 py-2.5">
					<span className="icon-[lucide--lock] size-3.5 text-faint" />
					<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">
						localhost:5174/sessions
					</span>
					<span className="rounded-full bg-card px-2 py-0.5 text-[11px] leading-4 font-medium text-dim">
						只读
					</span>
				</div>
				<div className="min-h-0 flex-1 overflow-hidden rounded-b-[18px] bg-card px-5 py-5">
					<p className="text-[11px] leading-4 font-medium tracking-[0.08em] text-faint uppercase">
						CodeKiln
					</p>
					<h1 className="mt-2 text-[22px] leading-7 font-bold tracking-[-0.01em]">会话恢复没有丢消息</h1>
					<p className="mt-2 text-[14px] leading-[22px] text-ink2">
						断开连接后重新配对，时间线会从 jsonl 回放补齐，条数与文件一致。过期序号只对实时事件生效。
					</p>
					<div className="mt-4 flex flex-col gap-2.5">
						<div className="flex items-center gap-2.5 rounded-[14px] bg-card2 px-3 py-2.5">
							<span className="icon-[lucide--check] size-4 text-green" />
							<span className="text-[13px] leading-[18px]">回放补偿：旧连接遗留的 seq 不再丢事件</span>
						</div>
						<div className="flex items-center gap-2.5 rounded-[14px] bg-card2 px-3 py-2.5">
							<span className="icon-[lucide--check] size-4 text-green" />
							<span className="text-[13px] leading-[18px]">断言：断开再恢复，条数与 jsonl 一致</span>
						</div>
					</div>
					<div className="mt-5 rounded-[14px] bg-ink px-3.5 py-3 font-mono text-[12px] leading-5 text-pill-ink">
						<span className="text-faint">$ </span>pnpm test -- sessionReducer
						<br />
						<span className="text-green">✓ 12 passed</span>
					</div>
					<div className="mt-4 flex flex-col divide-card2 divide-y">
						{[
							{ t: "恢复会话后时间线为空", s: "正在跑测试", d: "3 分钟" },
							{ t: "PWA 重设计：黑白 + 玻璃", s: "等一条命令批准", d: "现在" },
							{ t: "补 pair 协议的向量测试", s: "空闲", d: "昨天" },
						].map((r) => (
							<div
								key={r.t}
								className="flex items-center gap-2 py-2.5"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-[13px] leading-[18px] font-medium">{r.t}</p>
									<p className="truncate text-[11px] leading-4 text-dim">{r.s}</p>
								</div>
								<span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">{r.d}</span>
							</div>
						))}
					</div>
					<p className="mt-3 text-[11px] leading-4 text-faint">
						由会话启动的本地服务，改动会实时刷新。
					</p>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-8">
				<button className="glass flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium">
					<span className="icon-[lucide--history] size-[18px]" />
					上一页
				</button>
				<button className="glass-ink flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium">
					<span className="icon-[lucide--external-link] size-[18px]" />
					用浏览器看
				</button>
			</div>
		</div>
	);
}
