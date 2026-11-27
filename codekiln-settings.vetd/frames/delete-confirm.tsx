export const frame = { width: 1440, height: 900, title: "删除服务商 · 先退登再删除" };

import { Btn } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";

export default function DeleteConfirm() {
	return (
		<Window
			overlay={
				<Modal
					title="删除这个服务商？"
					width={440}
					footer={
						<>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>取消</Btn>
								<Btn tone="danger">删除</Btn>
							</span>
						</>
					}
				>
					<div className="space-y-3">
						<p className="text-[12.5px] leading-[19px] text-muted">
							删除 ChatGPT 订阅（yfdl@…）会先退登这个账号。同厂商的其他账号保持登录，不受影响。
						</p>
						<div className="flex items-start gap-2 rounded-[6px] border border-white/[0.08] bg-white/[0.02] px-3 py-2">
							<span className="icon-[lucide--key-round] size-[13px] shrink-0 text-faint" />
							<p className="text-[11px] leading-[16px] text-faint">
								凭证与条目是一体的：退登成功才会删条目。退登失败时条目保留，行内给「重试 /
								仍要删除」两条路。
							</p>
						</div>
						<p className="text-[11px] leading-[16px] text-faint">
							取消不产生任何副作用——只有「删除」会真的触发退登。
						</p>
					</div>
				</Modal>
			}
		>
			<ModelCenter failedProviderId="chatgpt-team" />
		</Window>
	);
}
