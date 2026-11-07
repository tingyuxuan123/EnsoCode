export const frame = { width: 412, height: 915, title: "成员单聊" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { BotAvatar } from "../components/BotAvatar";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Code, Prose, Steps, UserBubble } from "../components/Turn";
import { bots } from "../components/data";

const files = [
	{ name: "回归报告.md", size: "6.2 KB", icon: "icon-[lucide--file-text]" },
	{ name: "失败截图.png", size: "184 KB", icon: "icon-[lucide--image]" },
];

/** 和一位成员单聊：它的回复带着产物，点开就能看。 */
export default function BotChat() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/members"
				title="小测"
				detail="测试 · 线程：会话恢复回归"
				menu
				detailTo="/threads"
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<UserBubble>把会话恢复相关的回归跑一遍，有失败给我截图。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<div className="flex items-center gap-2">
						<BotAvatar
							bot={bots.ce}
							size={22}
						/>
						<span className="text-[15px] leading-5 font-semibold">小测</span>
						<span className="text-[12px] leading-4 text-dim">6 分钟前</span>
					</div>
					<Steps>已完成 9 步 · 跑了 40 个用例</Steps>
					<Prose>
						<p>跑完了：38 通过，2 失败，都在恢复后的重放顺序上。</p>
						<ul className="flex list-disc flex-col gap-1 pl-5 marker:text-faint">
							<li>
								<Code>replay keeps order after reconnect</Code>
							</li>
							<li>
								<Code>restored session shows queued echo</Code>
							</li>
						</ul>
						<p>第二个看起来是阿全刚改的 lastSeq 重置把排队回显也清掉了。</p>
					</Prose>
					<div className="flex flex-col gap-2">
						{files.map((f) => (
							<Link
								key={f.name}
								to="/artifact"
								className="flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3"
							>
								<span className={`${f.icon} size-5 shrink-0 text-ink2`} />
								<span className="min-w-0 flex-1 truncate text-[15px] leading-5 font-medium">{f.name}</span>
								<span className="shrink-0 text-[12px] leading-4 text-dim">{f.size}</span>
								<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
							</Link>
						))}
					</div>
				</article>
			</div>
			<Composer placeholder="回复小测" />
		</div>
	);
}
