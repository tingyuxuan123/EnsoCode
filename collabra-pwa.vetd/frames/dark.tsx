export const frame = { width: 402, height: 874, radius: 62, title: "深色会话" };

import type { CSSProperties } from "react";
import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Code, DiffCard, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 深色不是另一套皮肤：同一批组件，只把 token 倒过来（页面近黑、卡片抬一档、胶囊反白）。
const night = {
	"--color-page": "#0a0b0d",
	"--color-card": "#1c1f23",
	"--color-card2": "#24272c",
	"--color-line": "#31353b",
	"--color-ink": "#f4f5f6",
	"--color-ink2": "#cfd4da",
	"--color-dim": "#8b9096",
	"--color-faint": "#676e76",
	"--color-pill": "#f4f5f6",
	"--color-pill-ink": "#0a0b0d",
} as CSSProperties;

export default function Dark() {
	return (
		<div
			className="relative flex h-full flex-col overflow-hidden bg-page text-ink"
			style={night}
		>
			<StatusBar
				variant="island"
				tone="light"
			/>
			<TopBar
				lead="drawer"
				to="/sessions"
				title="恢复会话后时间线为空"
				detail="EnsoCode · Sonnet 4.6 · 思考 高"
				menu
				detailTo="/config"
			>
				<Link
					to="/artifacts"
					aria-label="会话菜单"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--ellipsis-vertical] size-6" />
				</Link>
			</TopBar>
			<div className="flex shrink-0 items-center gap-1.5 px-4 pb-2">
				<span className="flex h-8 items-center rounded-full bg-pill px-3.5 text-[13px] leading-4 font-medium text-pill-ink">
					主会话
				</span>
				<Link
					to="/group"
					className="flex h-8 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] leading-4 font-medium text-ink2"
				>
					<span className="icon-[lucide--bot] size-3.5" />
					阿全
				</Link>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<p className="pb-4 text-center text-[11px] leading-[14px] text-faint">今天 14:02</p>
				<UserBubble>恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead time="3 分钟前" />
					<Steps>已完成 7 步 · 读了 5 个文件，跑了 1 次测试</Steps>
					<Prose>
						<p>
							根因在 renderer 的 reducer：恢复时 worker 从 <Code>seq 1</Code> 重新回放事件，而 store
							里还留着旧连接的 <Code>lastSeq = 412</Code>，回放的事件全被当成过期丢掉了。
						</p>
						<p>
							修法是把重置放进回放的第一条事件，并把过期判定收窄到实时事件。补了两条测试：断开再恢复、回放中途换连接。
						</p>
					</Prose>
					<DiffCard
						files={2}
						add={38}
						del={6}
					/>
				</article>
			</div>
			<Composer
				meta={{ context: 38, tokens: "12.4k", cache: "92%", speed: "42 t/s" }}
			/>
		</div>
	);
}
