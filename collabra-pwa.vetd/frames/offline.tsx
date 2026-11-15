export const frame = { width: 402, height: 874, radius: 62, title: "连接异常" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";

// 连接异常：一个状态页。不摆卡片，只给原因、最后在线时间和两个动作。
export default function Offline() {
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
					<span className="icon-[lucide--wifi-off] size-7 text-dim" />
				</span>
				<h1 className="mt-5 text-[22px] leading-7 font-bold tracking-[-0.01em]">桌面端离线</h1>
				<p className="mt-2 text-[14px] leading-[22px] text-dim">
					书房 · MacBook Pro 最后在线 12 分钟前。
					<br />
					它可能休眠或退出了 Collabra。
				</p>
				<div className="mt-6 flex items-center gap-2.5">
					<button className="glass-ink flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium">
						<span className="icon-[lucide--rotate-cw] size-[18px]" />
						重新连接
					</button>
					<button className="glass flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium">
						<span className="icon-[lucide--monitor-smartphone] size-[18px]" />
						换设备
					</button>
				</div>
			</div>
			<div className="relative px-4 pb-10">
				<div className="rounded-[18px] bg-card px-4 py-3.5">
					<p className="text-[13px] leading-[18px] font-medium">离线时还能做什么</p>
					<p className="mt-1 text-[13px] leading-[20px] text-dim">
						已缓存的会话能看历史；给 Bot 发的消息会先存在手机上，等桌面端回来再送出去。
					</p>
				</div>
			</div>
		</div>
	);
}
