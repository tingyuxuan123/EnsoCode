export const frame = { width: 920, height: 500, title: "模型胶囊 · 三种状态" };

import { Composer } from "../components/Composer";

/** 胶囊是浮层唯一的锚点：它自己的状态得说明「关着 / 我展开了 / 这次不推理」。 */
const STATES = [
	{ caption: "默认：模型名 + 推理档位，档位用小色块，不再用分隔线", level: "最高", open: false, reasoning: true },
	{ caption: "点开：胶囊底色提亮、箭头翻转，与浮层同开同关", level: "最高", open: true, reasoning: true },
	{ caption: "关掉推理：胶囊只剩模型名，浮层右栏同步收起滑杆", level: "", open: false, reasoning: false },
];

export default function ComposerStates() {
	return (
		<div className="flex h-full flex-col justify-center gap-5 bg-ground px-7">
			{STATES.map((state) => (
				<div key={state.caption}>
					<p className="mb-2 text-[11px] text-faint">{state.caption}</p>
					<Composer
						model="GPT-6.2 Sol"
						level={state.level}
						open={state.open}
						reasoning={state.reasoning}
					/>
				</div>
			))}
		</div>
	);
}
