import { Link, useLocation } from "react-router";

const items = [
	{ to: "/thread", label: "对话", icon: "icon-[lucide--message-square]" },
	{ to: "/", label: "图片工作台", icon: "icon-[lucide--image]" },
	{ to: "/", label: "设计", icon: "icon-[lucide--ruler]" },
	{ to: "/", label: "看板", icon: "icon-[lucide--columns-3]" },
];

const BUTTON =
	"relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

export function IconRail() {
	const { pathname } = useLocation();
	const onImage = ["/", "/thread", "/history", "/settings"].includes(pathname);
	return (
		<nav className="flex w-14 shrink-0 flex-col items-center gap-2 py-3">
			<Link
				to="/"
				aria-label="小满"
				className="mb-1 flex size-8 items-center justify-center text-[17px] font-medium text-foreground"
			>
				满
			</Link>
			<button type="button" aria-label="收起侧栏" className={BUTTON}>
				<span className="icon-[lucide--panel-left] size-[18px]" />
			</button>
			<div className="my-1 w-5 border-t border-border" />
			{items.map((item) => {
				const active = item.label === "图片工作台" && onImage;
				return (
					<Link
						key={item.label}
						to={item.to}
						aria-label={item.label}
						title={item.label}
						aria-current={active ? "page" : undefined}
						className={`${BUTTON} ${active ? "bg-accent text-foreground" : ""}`}
					>
						<span className={`${item.icon} size-[19px]`} />
					</Link>
				);
			})}
			<div className="flex-1" />
			<button type="button" aria-label="询问 Enso" className={`${BUTTON} text-primary`}>
				<span className="icon-[lucide--sparkles] size-[19px]" />
			</button>
			<button type="button" aria-label="设置" className={BUTTON}>
				<span className="icon-[lucide--settings-2] size-[19px]" />
			</button>
		</nav>
	);
}
