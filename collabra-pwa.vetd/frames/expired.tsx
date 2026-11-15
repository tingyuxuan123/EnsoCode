export const frame = { width: 402, height: 874, radius: 62, title: "配对失效" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";

// 配对失效不等于离线：这台手机被桌面端解绑了，重连没用，只能重新配对。
export default function Expired() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
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
			</header>
			<div className="relative flex flex-1 flex-col items-center justify-center px-8 pb-16 text-center">
				<span className="flex size-16 items-center justify-center rounded-full bg-card shadow-[0_0_0_0.75px_rgb(0_0_0/0.05)]">
					<span className="icon-[lucide--unlink] size-7 text-dim" />
				</span>
				<h1 className="mt-5 text-[22px] leading-7 font-bold tracking-[-0.01em]">配对已失效</h1>
				<p className="mt-2 text-[14px] leading-[22px] text-dim">
					这台手机和书房的连接被解除了——可能是桌面端解绑，也可能太久没连过。
				</p>
				<div className="mt-6 flex items-center gap-2.5">
					<Link
						to="/pair"
						className="glass-ink flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium"
					>
						<span className="icon-[lucide--scan-line] size-[18px]" />
						重新配对
					</Link>
					<button className="glass flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium">
						<span className="icon-[lucide--monitor-smartphone] size-[18px]" />
						换台电脑
					</button>
				</div>
			</div>
			<div className="relative px-4 pb-10">
				<div className="rounded-[18px] bg-card px-4 py-3.5">
					<p className="text-[13px] leading-[18px] font-medium">对话不会丢</p>
					<p className="mt-1 text-[13px] leading-[20px] text-dim">
						历史都在电脑上。重新配对后还是原来那些会话，只是这台手机要重新拿一次访问权。
					</p>
				</div>
			</div>
		</div>
	);
}
