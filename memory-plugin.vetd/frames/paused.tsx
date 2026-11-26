export const frame = { width: 1360, height: 840, title: "记忆已暂停" };

import { counts } from "../components/data";

const keeps = [
	{ title: "不再注入", body: "模型下一轮拿不到任何记忆、日志或待办。" },
	{ title: "不再写入", body: "自动学习与提取被拒绝，已有内容只读。" },
	{ title: "不删除数据", body: `本机留着的 ${counts.memories} 条记忆与 ${counts.logs} 篇日志原地不动。` },
];

export default function Paused() {
	return (
		<main className="flex h-full items-center px-6">
			<div className="w-full max-w-[720px] pb-10">
				<span className="icon-[lucide--pause] size-5 text-faint" />
				<h1 className="mt-4 text-[20px] font-medium tracking-tight">记忆已暂停</h1>
				<p className="mt-2 max-w-[62ch] text-[13px] leading-[1.75] text-muted">
					设置里的“启用记忆”关着。插件仍在图标轨里，但这一轮不会有任何记忆进入上下文，搜索与阅读也停在这里。
				</p>

				<div className="mt-6 flex items-center gap-2">
					<button
						type="button"
						className="flex h-8 items-center gap-1.5 rounded-card bg-surface-foreground px-3 text-[12px] font-medium text-surface"
					>
						<span className="icon-[lucide--play] size-3.5" />
						启用记忆
					</button>
					<button
						type="button"
						className="h-8 rounded-card border border-line px-3 text-[12px] text-muted hover:text-surface-foreground"
					>
						打开设置
					</button>
				</div>
				<p className="mt-6 flex items-center gap-2 text-[11.5px] text-faint">
					<span className="size-[5px] rounded-full bg-faint" />
					上次成功注入：今天 14:20 · 2,958 字 · 12 条长期记忆
				</p>

				<dl className="mt-12 grid grid-cols-3 gap-8 border-t border-line pt-6">
					{keeps.map((item) => (
						<div key={item.title}>
							<dt className="text-[12px] font-medium">{item.title}</dt>
							<dd className="mt-1.5 text-[11.5px] leading-[1.7] text-muted">{item.body}</dd>
						</div>
					))}
				</dl>
			</div>
		</main>
	);
}
