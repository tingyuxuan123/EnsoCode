export const frame = { width: 412, height: 915, title: "新任务设置" };

import { Sheet, SheetLabel } from "../components/Sheet";
import { approvalModes } from "../components/data";
import NewTask from "./index";

const models = [
	{ name: "Claude Opus 5.5", provider: "Anthropic · 上次使用" },
	{ name: "GPT-6.1", provider: "OpenAI" },
	{ name: "DeepSeek V4.1 Flash", provider: "DeepSeek · 长上下文、快" },
];

const levels = ["最低", "低", "中", "高", "超高", "最大"];

/** 新任务设置：从新任务页的项目胶囊拉起。点一下就生效，不用再按确定。 */
export default function NewConfig() {
	return (
		<div className="relative h-full overflow-hidden">
			<NewTask />
			<Sheet
				backTo="/"
				title="新任务设置"
			>
				<div className="flex gap-2 px-5">
					<button className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-card px-4 text-[14px] font-medium">
						<span className="icon-[lucide--folder] size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate text-left">EnsoCode</span>
						<span className="icon-[lucide--chevrons-up-down] size-3.5 shrink-0 text-dim" />
					</button>
					<button className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-card px-4 text-[14px] font-medium">
						<span className="icon-[lucide--sliders-horizontal] size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate text-left">默认预设</span>
						<span className="icon-[lucide--chevrons-up-down] size-3.5 shrink-0 text-dim" />
					</button>
				</div>

				<SheetLabel>模型</SheetLabel>
				<div className="mx-3 overflow-hidden rounded-[20px] bg-card">
					{models.map((m, i) => (
						<button
							key={m.name}
							className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
								i > 0 ? "shadow-[inset_0_0.75px_0_var(--color-line)]" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="truncate text-[15px] leading-5 font-medium">{m.name}</div>
								<div className="truncate text-[12px] leading-4 text-dim">{m.provider}</div>
							</div>
							{i === 0 && <span className="icon-[lucide--check] size-5 shrink-0" />}
						</button>
					))}
				</div>

				<SheetLabel>思考强度</SheetLabel>
				<div className="mx-3 flex rounded-full bg-card2 p-1">
					{levels.map((l) => (
						<button
							key={l}
							className={`h-9 flex-1 rounded-full text-[14px] font-medium ${
								l === "高" ? "bg-pill text-pill-ink" : "text-ink2"
							}`}
						>
							{l}
						</button>
					))}
				</div>

				<SheetLabel>审批模式</SheetLabel>
				<div className="mx-3 overflow-hidden rounded-[20px] bg-card">
					{approvalModes.map((m, i) => (
						<button
							key={m.id}
							className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
								i > 0 ? "shadow-[inset_0_0.75px_0_var(--color-line)]" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="text-[15px] leading-5 font-medium">{m.title}</div>
								<div className="truncate text-[12px] leading-4 text-dim">{m.detail}</div>
							</div>
							{i === 0 && <span className="icon-[lucide--check] size-5 shrink-0" />}
						</button>
					))}
				</div>
			</Sheet>
		</div>
	);
}
