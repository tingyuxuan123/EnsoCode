export const frame = { width: 412, height: 915, title: "空态" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { HomeDock, HomeEntries, HomeGlow, HomeHeader } from "../components/HomeChrome";

/** 刚配对、还没有任何任务（Unavailable）：一句话说清楚这里会出现什么，给一个开始的动作。 */
export default function Empty() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<HomeGlow />
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<HomeHeader />
			<HomeEntries />
			<h2 className="px-5 py-2.5 text-[15px] leading-5 font-semibold text-dim">任务</h2>
			<div className="flex flex-col items-center px-10 pt-16 text-center">
				<span className="icon-[lucide--inbox] size-11 text-dim" />
				<h3 className="mt-3 text-[17px] leading-6 font-semibold">还没有任务</h3>
				<p className="mt-1.5 text-[14px] leading-5 text-dim">在手机或电脑上开始一个任务，它的进度、提问和审批都会出现在这里。</p>
				<Link
					to="/"
					className="glass-ink mt-6 flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium"
				>
					<span className="icon-[lucide--square-pen] size-[18px]" />
					新任务
				</Link>
			</div>
			<HomeDock canSearch={false} />
		</div>
	);
}
