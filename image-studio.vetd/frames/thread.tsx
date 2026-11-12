export const frame = { width: 1440, height: 900, title: "对话与成图" };

import { ThreadBody } from "../components/ThreadBody";
import { Workbench } from "../components/Workbench";

export default function Thread() {
	return (
		<Workbench>
			<ThreadBody />
		</Workbench>
	);
}
