export const frame = { width: 412, height: 915, title: "目标 · 已暂停" };

import { GoalView } from "../components/GoalView";

/** 目标已暂停：主按钮换成「继续」。 */
export default function GoalPaused() {
	return <GoalView paused />;
}
