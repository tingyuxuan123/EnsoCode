export function StatusBar() {
	return (
		<footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line px-4 text-[11px] text-muted-foreground">
			<span className="flex min-w-0 items-center gap-1.5">
				<span className="size-1.5 shrink-0 rounded-full bg-success" />
				<span className="icon-[lucide--laptop] size-3.5 shrink-0" />
				本地工作区
			</span>
			<span className="ml-auto flex items-center gap-3">
				<span className="flex items-center gap-1.5 text-foreground/80">
					<span className="icon-[lucide--loader-circle] size-3.5 text-primary" />3 个运行中
				</span>
				<span>数据留在本机</span>
			</span>
		</footer>
	);
}
