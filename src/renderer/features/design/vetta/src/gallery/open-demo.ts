import type { DesignSystem } from "../design-systems/types";
import { openDesignDemoPreview } from "../../../host/demo-preview";
import { designSystemDemoHtml } from "./DesignSystemDemo";

/** 保留上游签名；EnsoCode 仅在应用内沙箱展示，不落盘、不启动命令或外部浏览器。 */
export async function openDemoInBrowser(system: DesignSystem): Promise<boolean> {
	const html = designSystemDemoHtml(system);
	if (html === null) return false;
	openDesignDemoPreview(system.name, html);
	return true;
}
