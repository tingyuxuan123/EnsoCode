export const frame = { width: 1440, height: 900, title: "图片工作台 · 空状态" };

import { Link } from "react-router";
import { PromptComposer } from "../components/PromptComposer";
import { Workbench } from "../components/Workbench";

const suggestions = ["水彩风格的猫咪午后", "赛博朋克夜市街景", "极简产品海报，奶油色背景"];

export default function Empty() {
	return (
		<Workbench>
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex flex-1 flex-col items-center justify-center px-10">
					<span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
						<span className="icon-[lucide--sparkles] size-6" />
					</span>
					<h1 className="mt-6 text-[34px] font-medium tracking-tight text-foreground">
						今天想画点什么？
					</h1>
					<p className="mt-2 text-[13px] text-muted-foreground">
						一次出一张，参数在画图设置里；成图按会话归档
					</p>
					<div className="mt-8 flex gap-3">
						{suggestions.map((suggestion) => (
							<Link
								key={suggestion}
								to="/thread"
								className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-[13px] text-foreground hover:bg-secondary/40"
							>
								<span className="icon-[lucide--palette] size-4 text-muted-foreground" />
								{suggestion}
							</Link>
						))}
					</div>
				</div>
				<div className="px-8 pb-6">
					<div className="mx-auto w-full max-w-[820px]">
						<PromptComposer placeholder="描述你想生成的画面，或直接粘贴图片…" />
					</div>
				</div>
			</div>
		</Workbench>
	);
}
