export const frame = { width: 1360, height: 840, title: "搜索" };

import { project, searchHits, searchQuery } from "../components/data";

const query = searchQuery;
const hits = searchHits(query);

function Highlighted({ text }: { text: string }) {
	const at = text.toLowerCase().indexOf(query);
	if (at < 0) return <>{text}</>;
	return (
		<>
			{text.slice(0, at)}
			<mark className="rounded-[2px] bg-brand/20 px-0.5 font-medium text-surface-foreground">
				{text.slice(at, at + query.length)}
			</mark>
			{text.slice(at + query.length)}
		</>
	);
}

export default function Search() {
	return (
		<main className="px-6 pt-2 pb-6">
			<div className="flex h-9 items-center">
				<p className="text-[11.5px] text-faint">
					BM25 关键词检索 · 支持中文、#标签、[[链接]] · 不是语义搜索
				</p>
			</div>

			{hits.map((hit) => (
				<article key={hit.id} className="border-t border-line-soft py-4 first:border-t-0">
					<div className="flex items-center gap-2 text-[12px]">
						<span className="font-medium text-surface-foreground/90">{hit.source}</span>
						<span className="text-faint">·</span>
						<span className="text-muted">{hit.label}</span>
						<span className="text-faint">·</span>
						<span className="text-muted">{hit.scope === "global" ? "全局" : project}</span>
						<span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{hit.meta}</span>
						<span className="ml-4 flex items-center gap-0.5">
							<button
								type="button"
								title="定位到来源页签"
								className="flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-raise hover:text-surface-foreground"
							>
								<span className="icon-[lucide--corner-down-right] size-3.5" />
							</button>
							<button
								type="button"
								title="编辑"
								className="flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-raise hover:text-surface-foreground"
							>
								<span className="icon-[lucide--pencil] size-3.5" />
							</button>
						</span>
					</div>
					<p className="mt-2 max-w-[74ch] text-[13px] leading-[1.75]">
						<Highlighted text={hit.content} />
					</p>
				</article>
			))}

			<div className="mt-2 flex items-center justify-between border-t border-line pt-3.5">
				<button
					type="button"
					className="h-7 rounded-card border border-line px-2.5 text-[12px] text-muted opacity-40"
				>
					上一页
				</button>
				<span className="font-mono text-[11px] text-faint tabular-nums">
					{hits.length} 条结果 · 已到末尾
				</span>
				<button
					type="button"
					className="h-7 rounded-card border border-line px-2.5 text-[12px] text-muted"
				>
					下一页
				</button>
			</div>

			<div className="mt-6 flex items-start gap-2 text-[11.5px] leading-[1.7] text-faint">
				<span className="icon-[lucide--info] mt-[2px] size-3.5 shrink-0" />
				BM25 只命中完整词：换更短的词，或到「每日日志」按天翻。
			</div>
		</main>
	);
}
