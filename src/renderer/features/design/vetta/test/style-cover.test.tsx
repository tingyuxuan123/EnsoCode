import type { PluginContext } from "@vetta-org/plugin-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemTileContent } from "../src/cards/DesignSystemTileContent";
import type { DesignSystem } from "../src/design-systems/types";
import { setPluginCtx } from "../src/plugin-context";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/templates/";
const WEBP = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
const SRC = `data:image/webp;base64,${WEBP}`;
const request = vi.fn();
const disk = new Map<string, string>();
const context = {
	network: { request },
	storage: {
		readFile: async (path: string) => disk.get(path) ?? null,
		writeFile: async (path: string, data: string) => { disk.set(path, data); },
	},
} as unknown as PluginContext;

function system(id: string, url = `${BASE}${id}/cover.webp`, version = "1.0.0") {
	return {
		id,
		version,
		name: id,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources: [{ path: "cover.webp", role: "cover", encoding: "binary", url, bytes: atob(WEBP).length }],
		themeCss: "@theme { --color-surface: #010203; }",
		designMd: "# System",
	} satisfies DesignSystem & { version: string };
}

let host: HTMLDivElement;
let root: Root;
let intersect: (() => void) | undefined;

beforeEach(() => {
	intersect = undefined;
	disk.clear();
	request.mockReset().mockResolvedValue({ ok: true, body: WEBP });
	setPluginCtx(context);
	vi.stubGlobal("IntersectionObserver", class {
		constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
			intersect = () => callback([{ isIntersecting: true }]);
		}
		observe(): void {}
		disconnect(): void {}
	});
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

async function render(entry: DesignSystem): Promise<void> {
	await act(async () => root.render(<DesignSystemTileContent system={entry} demo={false} />));
}

async function enterViewport(): Promise<void> {
	await act(async () => intersect?.());
}

const image = (): HTMLImageElement | null => host.querySelector("img");
const palette = (): Element | null => host.querySelector("[style*='background']");

describe("style tile covers", () => {
	it("starts on the palette, then loads and fades in an in-viewport WebP through the host", async () => {
		const entry = system("visible");
		await render(entry);
		expect(palette()).not.toBeNull();
		expect(image()).toBeNull();
		expect(request).not.toHaveBeenCalled();
		await enterViewport();
		expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: entry.resources[0].url, method: "GET", responseType: "base64" }));
		expect(image()?.getAttribute("src")).toBe(SRC);
		// happy-dom reports a load for the data URL while act flushes.
		expect(image()?.style.opacity).toBe("1");
		expect(palette()).not.toBeNull();
		expect(host.querySelector("iframe")).toBeNull();
	});

	it("keeps the palette for missing, out-of-repo or invalid covers", async () => {
		await render({ ...system("empty"), resources: [] });
		expect(palette()).not.toBeNull();
		await render(system("out-of-repo", "https://raw.githubusercontent.com/other/repo/main/cover.webp"));
		await enterViewport();
		expect(image()).toBeNull();
		expect(request).not.toHaveBeenCalled();

		request.mockResolvedValueOnce({ ok: true, body: btoa("<svg onload='example()'/>") });
		await render(system("invalid"));
		await enterViewport();
		expect(request).toHaveBeenCalledTimes(1);
		expect(image()).toBeNull();
		expect(palette()).not.toBeNull();
	});

	it("removes an image that fails to decode, leaving the palette instead of a broken image", async () => {
		await render(system("decode-failure"));
		await enterViewport();
		expect(image()?.getAttribute("src")).toBe(SRC);
		act(() => { image()?.dispatchEvent(new Event("error")); });
		expect(image()).toBeNull();
		expect(palette()).not.toBeNull();
	});

	it("does not show a late completion after the manifest changes version at the same URL", async () => {
		let finish: ((value: unknown) => void) | undefined;
		request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
		await render(system("changing"));
		await enterViewport();
		await render(system("changing", undefined, "1.0.1"));
		await act(async () => finish?.({ ok: true, body: WEBP }));
		expect(image()).toBeNull();
		await enterViewport();
		expect(request).toHaveBeenCalledTimes(2);
		expect(image()?.getAttribute("src")).toBe(SRC);
	});

	it("reuses a stored cover on a fresh module load, but not after a version bump", async () => {
		const entry = system("restart");
		await render(entry);
		await enterViewport();
		expect(image()?.getAttribute("src")).toBe(SRC);
		vi.resetModules();
		const fresh = await import("../src/cards/DesignSystemTileContent");
		(await import("../src/plugin-context")).setPluginCtx(context);
		await act(async () => root.render(<fresh.DesignSystemTileContent system={entry} demo={false} />));
		await enterViewport();
		expect(image()?.getAttribute("src")).toBe(SRC);
		expect(request).toHaveBeenCalledTimes(1);
		await act(async () => root.render(<fresh.DesignSystemTileContent system={{ ...entry, version: "1.0.1" }} demo={false} />));
		expect(image()).toBeNull();
		await enterViewport();
		expect(image()?.getAttribute("src")).toBe(SRC);
		expect(request).toHaveBeenCalledTimes(2);
	});
});
