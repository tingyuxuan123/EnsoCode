import type { CardDescriptor } from "@vetta-org/plugin-sdk";

/** Card type this plugin renders; the tool's descriptor and the renderer agree on it. */
export const SCREENSHOT_CARD_TYPE = "vetta-ui-design:screenshot";

export const SCREENSHOT_TOOL_NAME = "vetd_screenshot";

export const SCREENSHOT_OVERVIEW_ID = "verification-overview";

/** Payloads carry references only — never image data. */
export interface ScreenshotCardPayload {
	dirPath: string;
	frameId: string;
}

interface ScreenshotOverviewPayload {
	dirPath: string;
	overviewCapturedAt: number;
}

/**
 * One logical card per frame: same key across turns = one card, shown only under
 * its latest anchor (host dedup). The tab label is the frame id — a code
 * identifier, so it needs no translation and stays distinguishable across frames.
 */
export function screenshotCardDescriptor(vetdPath: string, dirPath: string, frameId: string): CardDescriptor {
	return {
		type: SCREENSHOT_CARD_TYPE,
		key: `${vetdPath}#${frameId}`,
		title: frameId,
		payload: { dirPath, frameId } satisfies ScreenshotCardPayload,
	};
}

/** One preview per batch, anchored to the exact sheet written by that call. */
export function screenshotOverviewDescriptor(vetdPath: string, dirPath: string, overviewCapturedAt: number): CardDescriptor {
	return {
		type: SCREENSHOT_CARD_TYPE,
		// Empty suffix is batch-only: valid frame ids are non-empty, so keys cannot collide.
		key: `${vetdPath}#`,
		title: SCREENSHOT_OVERVIEW_ID,
		payload: { dirPath, overviewCapturedAt } satisfies ScreenshotOverviewPayload,
	};
}
