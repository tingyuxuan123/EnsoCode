export const frame = { width: 920, height: 560, title: "输入条 · 模型浮层展开" };

import { Composer } from "../components/Composer";
import { ModelPickerPanel } from "../components/ModelPickerPanel";
import { LEVELS, MAGPIE_GROUP, RAIL } from "../components/data";

export default function Picker() {
	return (
		<div className="flex h-full flex-col justify-end bg-ground px-7 pb-6">
			<div className="mb-1.5 flex justify-end">
				<ModelPickerPanel
					rail={RAIL}
					activeRail="magpie"
					query=""
					groups={[MAGPIE_GROUP]}
					levels={LEVELS}
					level="最高"
					modelLabel="GPT-6.2 Sol"
					note="不支持的档位会自动降档。"
				/>
			</div>
			<Composer model="GPT-6.2 Sol" level="最高" open />
		</div>
	);
}
