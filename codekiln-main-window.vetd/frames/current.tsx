export const frame = { width: 1280, height: 770, title: "主窗口 · 现状" };

import { AppWindow } from "../components/AppWindow";

export default function Frame() {
	return <AppWindow variant="current" />;
}
