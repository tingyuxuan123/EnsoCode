export function Segmented({ options, active }: { options: string[]; active: string }) {
	return (
		<div className="inline-flex rounded-[6px] bg-tile p-[2px]">
			{options.map((option) => (
				<span
					key={option}
					className={
						option === active
							? "rounded-[5px] bg-white/[0.1] px-[10px] py-[3px] text-[12px] text-foreground"
							: "rounded-[5px] px-[10px] py-[3px] text-[12px] text-muted"
					}
				>
					{option}
				</span>
			))}
		</div>
	);
}
