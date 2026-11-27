export const frame = { width: 1440, height: 900, title: "账号池 · 成员顺序与可用性" };

import { Badge, Btn, Checkbox } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";
import { poolMembers } from "../components/data";

export default function PoolProvider() {
	const selected = poolMembers.filter((member) => member.selected).length;

	return (
		<Window
			overlay={
				<Modal
					title="ChatGPT（自动故障转移）"
					note="池条目按顺序使用已启用且已登录的账号；模型与推理沿用池条目"
					width={820}
					footer={
						<>
							<span className="text-[11px] text-faint">
								已选 {selected} 个 · 池条目不显示单个账号的额度
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>取消</Btn>
								<Btn tone="primary" disabled={selected === 0}>
									保存
								</Btn>
							</span>
						</>
					}
				>
					<div className="flex items-baseline gap-2 pb-1.5">
						<span className="text-[11px] leading-[15px] text-muted">池成员</span>
						<span className="text-[10.5px] text-faint">
							{poolMembers.length} 个已登录账号 · 主 agent 与子代理共用
						</span>
					</div>
					<div className="space-y-0.5 rounded-[6px] border border-white/[0.08] p-1">
						{poolMembers.map((member, index) => (
							<div
								key={member.email}
								className={`flex items-center gap-2.5 rounded-[5px] px-2 py-[9px] ${member.selected ? "" : "opacity-70"}`}
							>
								<Checkbox checked={member.selected} />
								<span className="w-[16px] shrink-0 text-[10.5px] tabular-nums text-faint">
									{index + 1}.
								</span>
								<span className="min-w-0 flex-1 truncate text-[12.5px] leading-[17px]">
									{member.email}
								</span>
								<Badge tone="outline">{member.plan}</Badge>
								{!member.enabled ? <Badge tone="muted">账号已停用</Badge> : null}
								{!member.signedIn ? <Badge tone="muted">已登出</Badge> : null}
								<span className="w-[54px] shrink-0 text-right text-[10.5px] tabular-nums text-faint">
									{member.signedIn ? "已登录" : "—"}
								</span>
							</div>
						))}
					</div>
					<div className="mt-3 space-y-1.5 text-[11px] leading-[16px] text-faint">
						<p className="flex items-start gap-1.5">
							<span className="icon-[lucide--info] size-[12px] shrink-0" />
							停用或登出的账号仍可勾选，运行时会跳过它并换下一个；顺序就是勾选顺序。
						</p>
						<p className="flex items-start gap-1.5">
							<span className="icon-[lucide--shield] size-[12px] shrink-0" />
							池是一个稀疏覆盖条目：任一成员启用某模型，池里就启用它。
						</p>
					</div>
				</Modal>
			}
		>
			<ModelCenter />
		</Window>
	);
}
