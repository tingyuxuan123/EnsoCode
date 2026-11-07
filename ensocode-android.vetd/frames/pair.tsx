export const frame = { width: 412, height: 915, title: "连接电脑" };

import { StatusBar } from "@vetta/ios";
import { Enso } from "../components/Enso";
import { TopBar } from "../components/TopBar";

const corners = [
	"top-5 left-5 border-t-[3px] border-l-[3px] rounded-tl-2xl",
	"top-5 right-5 border-t-[3px] border-r-[3px] rounded-tr-2xl",
	"bottom-5 left-5 border-b-[3px] border-l-[3px] rounded-bl-2xl",
	"bottom-5 right-5 border-b-[3px] border-r-[3px] rounded-br-2xl",
];

const code = ["4", "8", "2", "1", "9", ""];

/** 连接电脑：扫桌面端的二维码，或手动输入局域网地址并核对 6 位验证码。 */
export default function Pair() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="close"
				to="/home"
				title="连接电脑"
			/>
			<div className="flex min-h-0 flex-1 flex-col px-5 pt-2">
				<div className="relative h-[300px] overflow-hidden rounded-[28px] bg-camera shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]">
					<div
						className="absolute inset-0"
						style={{ background: "radial-gradient(70% 60% at 50% 45%, rgb(255 255 255 / 0.07), transparent 70%)" }}
					/>
					{corners.map((c) => (
						<span
							key={c}
							className={`absolute size-11 border-white/90 ${c}`}
						/>
					))}
					<span className="absolute inset-x-12 top-[46%] h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
					<div className="absolute inset-x-0 bottom-9 flex flex-col items-center gap-2 text-white/75">
						<Enso
							size={22}
							className="text-white/60"
						/>
						<span className="text-[13px] leading-[18px]">对准电脑上的二维码</span>
					</div>
				</div>
				<p className="mt-4 px-1 text-[15px] leading-[22px] text-ink2">在电脑上打开 EnsoCode → 设置 → 手机，扫描出现的二维码即可配对。</p>

				<h2 className="mt-7 px-1 text-[15px] leading-5 font-semibold text-dim">或手动连接</h2>
				<label className="mt-3 block px-1 text-[12px] leading-4 text-dim">电脑的局域网地址</label>
				<div className="mt-1.5 flex h-12 items-center gap-2 rounded-3xl border border-line bg-card px-4">
					<span className="icon-[lucide--laptop] size-[18px] text-dim" />
					<span className="flex-1 font-mono text-[15px]">192.168.1.24:47821</span>
				</div>
				<label className="mt-4 block px-1 text-[12px] leading-4 text-dim">电脑上显示的 6 位验证码</label>
				<div className="mt-1.5 flex gap-2">
					{code.map((d, i) => (
						<span
							key={i}
							className={`flex h-[52px] flex-1 items-center justify-center rounded-[14px] bg-card font-mono text-[22px] font-medium ${
								d === "" ? "shadow-[inset_0_0_0_1.5px_var(--color-ink)]" : ""
							}`}
						>
							{d === "" ? <span className="h-6 w-0.5 animate-pulse bg-ink" /> : d}
						</span>
					))}
				</div>
				<p className="mt-3 flex items-center gap-1.5 px-1 text-[12px] leading-4 text-dim">
					<span className="icon-[lucide--lock] size-3.5" />
					端到端加密，中继只转发密文
				</p>
			</div>
			<div className="px-5 pt-3 pb-9">
				<button className="glass-ink flex h-14 w-full items-center justify-center gap-2 rounded-full text-[16px] font-medium">
					<span className="icon-[lucide--link-2] size-5" />
					配对
				</button>
			</div>
		</div>
	);
}
