export const frame = { width: 1360, height: 840, title: "设置" };

import { Input, Select, Setting, Toggle } from "../components/Field";
import { nf, pack, settings } from "../components/data";

const used = Math.round((pack.total / pack.budget) * 100);

export default function Settings() {
	return (
		<main className="px-6 pt-5 pb-8">
			<div className="grid max-w-[1200px] grid-cols-3 gap-x-10">
				<section>
					<h2 className="text-[13px] font-medium">学习与总结</h2>
					<p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
						关闭后插件不写任何新内容，只读已有数据。
					</p>
					<div className="mt-3">
						<Setting title="启用记忆" control={<Toggle on />} />
						<Setting
							title="自动学习"
							description="每轮结束后提取最多 3 条长期记忆，默认落在当前项目，不记录原始对话。"
							control={<Toggle on={settings.autoLearn} />}
						/>
						<Setting
							title="自动会话总结"
							description="从第 2 轮开始更新当日检查点，退出前已落盘。"
							control={<Toggle on={settings.summarizeOnEnd} />}
						/>
						<Setting
							title="整理模型"
							description="扩展 → 记忆 → 配置；密钥由宿主管理。"
							control={<Select value={settings.model} width="w-[132px]" />}
						/>
					</div>
				</section>

				<section>
					<h2 className="text-[13px] font-medium">上下文预算</h2>
					<p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
						优先级：待办 → 今日日志 → 置顶 / 长期记忆 → 相关 → 昨日日志。
					</p>
					<div className="mt-3">
						<Setting
							title="快照模式"
							description="稳定快照在数据、设置、压缩或跨天时刷新；逐轮检索每轮再挑 3 条相关记忆。"
							control={<Select value="稳定快照" width="w-[112px]" />}
						/>
						<Setting title="注入今日 / 昨日日志" control={<Toggle on={settings.includeDaily} />} />
						<Setting title="注入未完成待办" control={<Toggle on={settings.includeTodos} />} />
						<Setting
							title="长期记忆条数"
							description={`当前 ${pack.picked} 条，另外 ${pack.overflow} 条不进下一轮。`}
							control={<Input value={String(settings.maxMemories)} unit="条" />}
						/>
						<Setting
							title="上下文总字符预算"
							description="按优先级装入，整条放不下的直接跳过，不截断单条。"
							control={<Input value={nf(settings.maxChars)} unit="字" />}
						/>
					</div>

					<div className="mt-4 rounded-card bg-raise p-3">
						<div className="flex items-baseline justify-between">
							<span className="text-[11.5px] text-muted">按当前设置，本轮装入</span>
							<span className="font-mono text-[11px] text-surface-foreground tabular-nums">
								{nf(pack.total)} / {nf(pack.budget)} 字
							</span>
						</div>
						<div className="mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-line">
							{pack.sections
								.filter((section) => section.included > 0)
								.map((section) => (
									<span
										key={section.key}
										className="h-full rounded-full bg-brand"
										style={{ width: `${(section.chars / pack.budget) * 100}%` }}
									/>
								))}
						</div>
						<p className="mt-2 text-[11px] text-faint tabular-nums">
							占用 {used}% · 预算还有 {nf(pack.budget - pack.total)} 字，真正的限制是条数上限
						</p>
					</div>
				</section>

				<section>
					<h2 className="text-[13px] font-medium">数据与产物</h2>
					<p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
						产物只包含全局与当前项目的数据，卸载会删除插件私有目录。
					</p>
					<div className="mt-3 space-y-2">
						<button
							type="button"
							className="flex h-8 w-full items-center gap-2 rounded-card border border-line px-2.5 text-[12px] transition-colors hover:border-muted/40"
						>
							<span className="icon-[lucide--sparkles] size-3.5 text-muted" />
							立即提取本会话
						</button>
						<button
							type="button"
							className="flex h-8 w-full items-center gap-2 rounded-card border border-line px-2.5 text-[12px] transition-colors hover:border-muted/40"
						>
							<span className="icon-[lucide--clipboard-copy] size-3.5 text-muted" />
							复制为 Markdown
						</button>
						<button
							type="button"
							className="flex h-8 w-full items-center gap-2 rounded-card border border-line px-2.5 text-[12px] transition-colors hover:border-muted/40"
						>
							<span className="icon-[lucide--archive] size-3.5 text-muted" />
							生成 JSON 备份产物
						</button>
					</div>
					<p className="mt-3 flex items-start gap-2 text-[11px] leading-[1.6] text-faint">
						<span className="icon-[lucide--shield-check] mt-[2px] size-3.5 shrink-0" />
						新增、编辑与模型提取都会拒绝疑似凭证；磁盘中的敏感条目也不会注入。
					</p>
				</section>
			</div>

			<section className="mt-8 max-w-[1200px] border-t border-line pt-5">
				<div className="flex items-start justify-between gap-10">
					<div>
						<h2 className="text-[13px] font-medium">数据安全</h2>
						<p className="mt-1.5 max-w-[86ch] text-[11.5px] leading-[1.7] text-muted">
							自动学习与总结会把已隐去疑似凭证的最近 12 轮文本（每条最多 1200 字符）发给所选模型，可能产生费用。凭证检测不是绝对保证，请不要在对话中发送秘密。所有删除先进入回收站。
						</p>
					</div>
					<button
						type="button"
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-card border border-danger/35 px-2.5 text-[12px] text-danger transition-colors hover:border-danger/60"
					>
						清空当前可见数据…
					</button>
				</div>
			</section>
		</main>
	);
}
