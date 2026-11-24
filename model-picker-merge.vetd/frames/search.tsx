export const frame = { width: 920, height: 490, title: "搜索 · 跨条目平铺" };

import { Composer } from "../components/Composer";
import { ModelPickerPanel } from "../components/ModelPickerPanel";
import { LEVELS, RAIL, SEARCH_GROUP } from "../components/data";

export default function Search() {
	return (
		<div className="flex h-full flex-col justify-end bg-ground px-7 pb-6">
			<div className="mb-1.5 flex justify-end">
				<ModelPickerPanel
					rail={RAIL}
					activeRail="magpie"
					query="sol"
					searching
					groups={[SEARCH_GROUP]}
					levels={LEVELS}
					level="最高"
					modelLabel="GPT-6.2 Sol"
					height={300}
					note="不支持的档位会自动降档。"
				/>
			</div>
			<Composer model="GPT-6.2 Sol" level="最高" open />
		</div>
	);
}
