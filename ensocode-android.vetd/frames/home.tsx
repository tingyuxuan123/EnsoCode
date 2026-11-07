export const frame = { width: 412, height: 915, title: "任务列表" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { HomeDock, HomeEntries, HomeGlow, HomeHeader } from "../components/HomeChrome";
import { SessionMeta } from "../components/SessionMeta";
import { StatusGlyph } from "../components/StatusGlyph";
import { sessions } from "../components/data";

/** 抽屉首页（HomeScreen）：标题旁是连接状态，下面几个入口，再往下是全部任务。搜索和设置浮在右下。 */
export default function Home() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<HomeGlow />
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<HomeHeader />
			<div className="relative min-h-0 flex-1 overflow-hidden pb-32">
				<HomeEntries />
				<div className="flex items-center gap-2.5 px-5 py-2.5">
					<h2 className="flex-1 text-[15px] leading-5 font-semibold text-dim">任务</h2>
					<button
						aria-label="按状态筛选：全部"
						className="flex size-[38px] items-center justify-center rounded-full bg-card2 text-ink2"
					>
						<span className="icon-[mdi--sort] size-[18px]" />
					</button>
					<button
						aria-label="按项目筛选"
						className="flex size-[38px] items-center justify-center rounded-full bg-card2 text-ink2"
					>
						<span className="icon-[lucide--folder] size-[18px]" />
					</button>
				</div>
				{sessions.map((s) => (
					<div
						key={s.id}
						className={`flex items-center ${s.status === "waiting" ? "bg-yellow/[0.09]" : ""}`}
					>
						<Link
							to={s.to}
							className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-5"
						>
							{s.pinned && (
								<span className="flex h-[22px] shrink-0 items-center">
									<span className="icon-[mdi--pin] size-3.5 text-yellow" />
								</span>
							)}
							<div className="min-w-0 flex-1">
								<div className="truncate text-[16px] leading-[22px] font-medium">{s.title}</div>
								<SessionMeta
									project={s.project}
									time={s.time}
								/>
							</div>
							<span className="flex h-[22px] shrink-0 items-center">
								<StatusGlyph
									status={s.status}
									size={15}
								/>
							</span>
						</Link>
						<button
							aria-label="更多"
							className="mr-1 flex size-12 shrink-0 items-center justify-center text-ink2"
						>
							<span className="icon-[mdi--dots-vertical] size-6" />
						</button>
					</div>
				))}
			</div>
			<HomeDock />
		</div>
	);
}
