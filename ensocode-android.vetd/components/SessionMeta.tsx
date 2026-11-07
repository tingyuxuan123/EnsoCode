/** 会话标题下的一行：文件夹图标 + 项目名，再跟时间。对话没有项目，只显示时间。 */
export function SessionMeta({ project, time }: { project?: string; time: string }) {
	return (
		<div className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-ink2">
			{project && (
				<>
					<span className="icon-[lucide--folder] size-3 shrink-0" />
					<span className="truncate">{project}</span>
				</>
			)}
			<span className={project ? "ml-1.5 shrink-0" : "shrink-0"}>{time}</span>
		</div>
	);
}
