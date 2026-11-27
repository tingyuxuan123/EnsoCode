export const frame = { width: 1440, height: 900, title: "从本机导入 · 扫描结果与去重" };

import { BrandMark } from "../components/BrandMark";
import { Badge, Btn, Checkbox } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";
import { importApps } from "../components/data";

const checkedCount = importApps.reduce(
	(sum, app) => sum + app.candidates.filter((candidate) => candidate.checked).length,
	0,
);
const totalCandidates = importApps.reduce((sum, app) => sum + app.candidates.length, 0);

export default function LocalImport() {
	return (
		<Window
			overlay={
				<Modal
					title="从本机导入"
					note={`扫描到 ${importApps.length} 个应用 · ${totalCandidates} 条候选 · 已存在的默认不勾选`}
					width={900}
					footer={
						<>
							<span className="text-[11px] text-faint">
								已选 {checkedCount} 个 · 导入后逐个拉模型，再决定启用哪些
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>
									<span className="icon-[lucide--refresh-cw] size-[12px]" />
									重新扫描
								</Btn>
								<Btn tone="primary">导入所选</Btn>
							</span>
						</>
					}
				>
					<div className="space-y-3">
						{importApps.map((app) => (
							<div key={app.app} className="rounded-[7px] border border-white/[0.07]">
								<div className="flex items-center gap-2.5 px-3 pb-1.5 pt-2.5">
									<span className="flex size-[24px] shrink-0 items-center justify-center rounded-[5px] bg-white/[0.05]">
										{app.mark === "claude" ? (
											<BrandMark brand="anthropic" />
										) : (
											<span
												className={`${app.mark === "cherry" ? "icon-[lucide--app-window]" : "icon-[lucide--messages-square]"} size-[14px] text-muted`}
											/>
										)}
									</span>
									<span className="text-[12.5px] font-medium leading-[17px]">{app.app}</span>
									<span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-[14px] text-faint">
										{app.path}
									</span>
									<span className="shrink-0 text-[10.5px] tabular-nums text-faint">
										{app.candidates.length} 条
									</span>
								</div>
								{app.candidates.map((candidate, index) => (
									<div
										key={candidate.id}
										className={`flex items-center gap-2.5 px-3 py-[9px] ${index === 0 ? "border-t border-white/[0.06]" : "border-t border-white/[0.04]"} ${candidate.checked ? "" : "opacity-70"}`}
									>
										<Checkbox checked={candidate.checked} />
										<span className="w-[132px] shrink-0 truncate text-[12px] leading-[16px]">
											{candidate.name}
										</span>
										<span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-[14px] text-faint">
											{candidate.baseUrl}
										</span>
										{candidate.duplicate ? <Badge tone="muted">已存在</Badge> : null}
										<span className="w-[52px] shrink-0 text-right text-[10.5px] tabular-nums text-faint">
											{candidate.models} 模型
										</span>
									</div>
								))}
							</div>
						))}
					</div>
					<p className="flex items-start gap-1.5 pt-2.5 text-[11px] leading-[16px] text-faint">
						<span className="icon-[lucide--shield] size-[12px] shrink-0" />
						只读取本机应用里的地址与密钥，写进 CodeKiln 自己的配置；不动原应用的任何文件。
					</p>
				</Modal>
			}
		>
			<ModelCenter />
		</Window>
	);
}
