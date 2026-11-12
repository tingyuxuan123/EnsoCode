import { Link } from "react-router";

const conversations = [
	{ title: "雾中松林 4K 横版", when: "现在", count: 8, active: true },
	{ title: "百合花 竖版 1K", when: "42分钟前", count: 3 },
	{ title: "电商海报 主图", when: "昨天", count: 12 },
	{ title: "night-bake 封面", when: "昨天", count: 5 },
	{ title: "青绿纹理 卡片底", when: "周二", count: 4 },
];

export function ConversationSidebar() {
	return (
		<aside className="flex w-[296px] shrink-0 flex-col border-r border-line">
			<div className="flex h-11 shrink-0 items-center gap-2 px-3">
				<span className="text-[13px] font-medium text-foreground">对话</span>
				<button
					type="button"
					aria-label="搜索对话"
					className="ml-auto flex size-9 items-center justify-center rounded-md bg-accent/60 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<span className="icon-[lucide--search] size-4" />
				</button>
			</div>
			<Link
				to="/"
				className="mx-3 flex h-9 shrink-0 items-center gap-2 rounded-md px-1.5 text-[14px] text-foreground hover:bg-accent"
			>
				<span className="icon-[lucide--circle-plus] size-[17px] shrink-0 text-primary" />
				新建对话
				<span className="ml-auto rounded border border-border px-1 text-[11px] text-muted-foreground">
					⌘N
				</span>
			</Link>
			<div className="mt-4 flex shrink-0 items-center gap-1 px-4 pb-1 text-[12px] text-muted-foreground">
				<span className="min-w-0 flex-1 truncate">最近</span>
				<button
					type="button"
					aria-label="按时间排序"
					className="flex size-6 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
				>
					<span className="icon-[lucide--arrow-down-wide-narrow] size-3.5" />
				</button>
			</div>
			<ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2">
				{conversations.map((conversation) => (
					<li key={conversation.title}>
						<Link
							to="/thread"
							className={`flex h-8 items-center gap-2 rounded-md px-2 text-[13px] ${
								conversation.active
									? "bg-accent text-foreground"
									: "text-foreground/85 hover:bg-accent/60"
							}`}
						>
							<span className="icon-[lucide--image] size-4 shrink-0 text-muted-foreground" />
							<span className="truncate">{conversation.title}</span>
							<span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
								<span className="icon-[lucide--layers] size-3" />
								<span className="tabular-nums">{conversation.count}</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</aside>
	);
}
