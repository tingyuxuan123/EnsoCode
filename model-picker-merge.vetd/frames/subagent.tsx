export const frame = { width: 920, height: 560, title: "子模型 · 三态推理" };

import { Composer } from "../components/Composer";
import { ModelPickerPanel } from "../components/ModelPickerPanel";
import { LEVELS, MAGPIE_GROUP, RAIL } from "../components/data";

export default function SubagentModel() {
	return (
		<div className="flex h-full flex-col justify-end bg-ground px-7 pb-6">
			<div className="mb-1.5 flex justify-end">
				<ModelPickerPanel
					rail={RAIL}
					activeRail="magpie"
					query=""
					groups={[MAGPIE_GROUP]}
					levels={LEVELS}
					level="高"
					reasoningMode="on"
					modelLabel="GPT-6.2 Sol"
					note="跟随父会话时沿用主会话的档位，这里不再单独设。"
				/>
			</div>
			<Composer model="GPT-6.2 Sol" level="高" open />
		</div>
	);
}
