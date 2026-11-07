export const frame = { width: 412, height: 915, title: "产物预览" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";

const rows = [
	{ suite: "sessionReducer", pass: 14, fail: 0 },
	{ suite: "pair/replay", pass: 9, fail: 1 },
	{ suite: "queueSendEcho", pass: 6, fail: 1 },
	{ suite: "sessionCache", pass: 9, fail: 0 },
];

const tabs = ["回归报告.md", "失败截图.png", "coverage.html"];

/** 产物预览：Markdown、图片、PDF、HTML 在手机上直接渲染；右上角分享和下载。 */
export default function Artifact() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/bot"
				title="回归报告.md"
				detail="小测 · 6.2 KB · 14:02"
			>
				<button
					aria-label="分享"
					className="flex size-10 items-center justify-center rounded-full text-ink2"
				>
					<span className="icon-[lucide--share-2] size-5" />
				</button>
				<button
					aria-label="下载"
					className="flex size-10 items-center justify-center rounded-full text-ink2"
				>
					<span className="icon-[lucide--download] size-5" />
				</button>
			</TopBar>
			<div className="flex gap-2 overflow-hidden px-4 pt-1 pb-3">
				{tabs.map((t, i) => (
					<button
						key={t}
						className={`h-9 shrink-0 rounded-full px-4 text-[14px] font-medium ${
							i === 0 ? "bg-pill text-pill-ink" : "bg-card2 text-ink2"
						}`}
					>
						{t}
					</button>
				))}
			</div>
			<article className="mx-3 min-h-0 flex-1 overflow-hidden rounded-t-[22px] bg-card px-5 pt-6">
				<h1 className="text-[24px] leading-8 font-semibold">会话恢复回归报告</h1>
				<p className="mt-1 text-[13px] leading-[18px] text-dim">分支 fix/restore-timeline · 11 月 7 日 14:02 · 用时 1 分 48 秒</p>
				<p className="mt-4 text-[15px] leading-6">
					共 40 个用例，<b className="font-semibold text-green">38 通过</b>，<b className="font-semibold text-red">2 失败</b>
					。失败都出现在断线重连后的事件重放上。
				</p>
				<table className="mt-4 w-full text-[14px] leading-5 tabular-nums">
					<thead>
						<tr className="text-left text-[12px] text-dim">
							<th className="py-2 font-medium">测试集</th>
							<th className="py-2 text-right font-medium">通过</th>
							<th className="py-2 text-right font-medium">失败</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr
								key={r.suite}
								className="shadow-[inset_0_0.75px_0_var(--color-line)]"
							>
								<td className="py-2 font-mono text-[13px]">{r.suite}</td>
								<td className="py-2 text-right">{r.pass}</td>
								<td className={`py-2 text-right ${r.fail ? "font-semibold text-red" : "text-faint"}`}>{r.fail}</td>
							</tr>
						))}
					</tbody>
				</table>
				<h2 className="mt-6 text-[17px] leading-6 font-semibold">restored session shows queued echo</h2>
				<p className="mt-1.5 text-[15px] leading-6">恢复后排队消息的回显被清空，用户看不到自己刚排进去的消息。</p>
				<pre className="mt-3 overflow-hidden rounded-[14px] bg-card2 px-4 py-3 font-mono text-[12.5px] leading-5 text-ink2">
					{`expected queued.length 1
received 0
  at queueSendEcho.test.ts:42:18`}
				</pre>
			</article>
		</div>
	);
}
