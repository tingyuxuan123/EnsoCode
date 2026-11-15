export const frame = { width: 402, height: 874, radius: 62, title: "会话" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Code, DiffCard, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 会话：用户气泡反色，回复不用气泡；工具步骤收成一行，改动用白卡摘要。
export default function Chat() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
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
			<div className="flex shrink-0 items-center gap-1.5 overflow-hidden px-4 pb-2">
				<span className="flex h-8 items-center rounded-full bg-pill px-3.5 text-[13px] leading-4 font-medium text-pill-ink">
					主会话
				</span>
				<Link
					to="/group"
					className="flex h-8 items-center gap-1.5 rounded-full bg-card2 px-3.5 text-[13px] leading-4 font-medium text-ink2"
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
