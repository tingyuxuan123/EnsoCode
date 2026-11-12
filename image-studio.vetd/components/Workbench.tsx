import type { ReactNode } from "react";
import { ConversationSidebar } from "./ConversationSidebar";
import { IconRail } from "./IconRail";
import { MainTabs } from "./MainTabs";
import { StatusBar } from "./StatusBar";
import { WindowChrome } from "./WindowChrome";

export function Workbench({
	children,
	panel,
	panelOpen,
}: {
	children: ReactNode;
	panel?: ReactNode;
	panelOpen?: boolean;
}) {
	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<WindowChrome panelOpen={panelOpen} />
			<div className="flex min-h-0 flex-1">
				<IconRail />
				<ConversationSidebar />
				<div className="flex min-h-0 min-w-0 flex-1">
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<MainTabs />
						<div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
					</div>
					{panel}
				</div>
			</div>
			<StatusBar />
		</div>
	);
}
