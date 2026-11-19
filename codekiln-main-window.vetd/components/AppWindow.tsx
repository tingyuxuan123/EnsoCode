import { ChatBand, ChatBody, ChatComposer, ChatPane, ChatStatus } from "./ChatPane";
import { DevicePanel, PanelBand, PanelBody } from "./DevicePanel";
import { Rail } from "./Rail";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import type { Variant } from "./variant";

export function AppWindow({ variant }: { variant: Variant }) {
	const unified = variant === "unified";
	return (
		<div className="flex h-full flex-col bg-rail">
			<TitleBar />
			<div className="flex min-h-0 flex-1">
				<Rail />
				<div className={`flex min-h-0 flex-1 ${unified ? "bg-mat" : "bg-rail"}`}>
					<Sidebar variant={variant} />
					{/* 真实界面这里是 1px 宽的拖拽手柄，本身透明；不画线 */}
					<span className="w-px shrink-0" />
					<div className={`flex min-h-0 min-w-0 flex-1 ${unified ? "p-1" : "p-1.5"}`}>
						<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-card bg-paper">
							{unified ? (
								<div className="flex min-h-0 min-w-0 flex-1 flex-col">
									<div className="flex h-10 shrink-0 items-stretch border-b border-line">
										<div className="flex min-w-0 flex-1 items-center">
											<ChatBand variant={variant} />
										</div>
										<span className="my-2 w-px shrink-0 bg-line" />
										<div className="flex w-[401px] shrink-0 items-center">
											<PanelBand variant={variant} />
										</div>
									</div>
									<div className="flex min-h-0 min-w-0 flex-1">
										<section className="flex min-w-0 flex-1 flex-col bg-paper">
											<ChatBody />
											<ChatComposer />
											<ChatStatus variant={variant} />
										</section>
										<aside className="flex w-[401px] shrink-0 flex-col border-l border-line bg-paper">
											<PanelBody variant={variant} />
										</aside>
									</div>
								</div>
							) : (
								<>
									<ChatPane variant={variant} />
									<DevicePanel variant={variant} />
								</>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
