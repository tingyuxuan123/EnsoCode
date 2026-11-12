import { byId } from "./data";
import { PromptComposer } from "./PromptComposer";
import { ResultCard } from "./ResultCard";

const forest = byId("4d02b7c9");
const mono = byId("b31e6d40");

export function ThreadBody() {
	return (
		<>
			<div className="min-h-0 flex-1 overflow-hidden px-8">
				<div className="mx-auto flex max-w-[820px] flex-col gap-3 py-4">
					<div className="flex justify-end">
						<p className="max-w-[520px] rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-[13px] leading-[1.7] text-secondary-foreground">
							画一张 4K 横版的雾中松林壁纸，粉色晨雾，低饱和
						</p>
					</div>
					<div className="flex items-start gap-3">
						<span className="mt-2.5 shrink-0 icon-[lucide--sparkles] size-4 text-primary" />
						<ResultCard print={forest} />
					</div>
					<div className="flex justify-end">
						<p className="max-w-[520px] rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-[13px] leading-[1.7] text-secondary-foreground">
							改成黑白高反差，只留雾和树影
						</p>
					</div>
					<div className="flex items-start gap-3">
						<span className="mt-2.5 shrink-0 icon-[lucide--sparkles] size-4 text-primary" />
						<ResultCard print={mono} />
					</div>
				</div>
			</div>
			<div className="shrink-0 px-8 pb-6">
				<div className="mx-auto max-w-[820px]">
					<PromptComposer
						placeholder="接着上一张，把雾再压暗一档，横版 16:9"
						ready
						used={3}
						count={1}
					/>
				</div>
			</div>
		</>
	);
}
