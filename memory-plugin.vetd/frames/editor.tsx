export const frame = { width: 1360, height: 840, title: "新增记忆" };

import { Input, Select, Toggle } from "../components/Field";
import { memories, project } from "../components/data";
import { MemoryRow } from "../components/MemoryRow";

const draft =
	"插件视图的图标用 <img> 渲染，currentColor 不生效：导出线条图标时要选一个在浅色与深色外壳上都成立的中间灰。";

export default function Editor() {
	return (
		<div className="relative h-full">
			<main className="px-6 pt-2">
				{memories.slice(0, 4).map((row) => (
					<MemoryRow key={row.id} row={row} />
				))}
			</main>

			<div className="fixed inset-0 z-40 flex items-center justify-center bg-surface/75">
				<form className="w-[560px] rounded-[8px] border border-line bg-panel p-6">
					<div className="flex items-start justify-between">
						<div>
							<h2 className="text-[15px] font-medium">新增记忆</h2>
							<p className="mt-1 text-[11.5px] text-faint">
								会存进 记忆 · {project}，并在下一轮注入
							</p>
						</div>
						<button
							type="button"
							className="flex size-6 items-center justify-center rounded-[4px] text-muted hover:bg-raise hover:text-surface-foreground"
						>
							<span className="icon-[lucide--x] size-4" />
						</button>
					</div>

					<div className="mt-5 grid grid-cols-[1fr_1fr] gap-4">
						<div>
							<label className="text-[11.5px] text-muted">类型</label>
							<div className="mt-1.5">
								<Select value="经验" width="w-full" />
							</div>
						</div>
						<div>
							<label className="text-[11.5px] text-muted">范围</label>
							<div className="mt-1.5 flex h-8 items-center rounded-card border border-line p-0.5 text-[12px]">
								<span className="flex h-6 flex-1 items-center justify-center rounded-[4px] bg-raise text-surface-foreground">
									当前项目
								</span>
								<span className="flex h-6 flex-1 items-center justify-center text-muted">全局</span>
							</div>
						</div>
					</div>

					<div className="mt-4">
						<label className="text-[11.5px] text-muted">内容</label>
						<div className="mt-1.5 rounded-card border border-line bg-surface px-3 py-2.5">
							<p className="min-h-[92px] text-[13px] leading-[1.75]">{draft}</p>
						</div>
						<div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
							<span>不要保存密码、密钥或令牌</span>
							<span className="font-mono tabular-nums">{draft.length} / 2000</span>
						</div>
					</div>

					<div className="mt-4 flex items-center justify-between border-t border-line-soft pt-3.5">
						<span className="flex items-center gap-2 text-[12px] text-muted">
							<Toggle on={false} />
							置顶（优先装入下一轮）
						</span>
						<span className="flex items-center gap-2 text-[11px] text-faint tabular-nums">
							本轮预算 +{draft.length} 字
						</span>
					</div>

					<div className="mt-5 flex items-center justify-end gap-2">
						<button
							type="button"
							className="h-8 rounded-card border border-line px-3 text-[12px] text-muted hover:text-surface-foreground"
						>
							取消
						</button>
						<button
							type="button"
							className="h-8 rounded-card bg-surface-foreground px-3 text-[12px] font-medium text-surface"
						>
							保存
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
