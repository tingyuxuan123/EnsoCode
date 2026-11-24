import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) =>
			params ? `${key}:${Object.values(params).join(",")}` : key,
		locale: "zh",
	}),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesignSystemGrid } from "../src/gallery/DesignSystemGrid";
import { markCatalogFailed, resetDesignSystems, setDesignSystems } from "../src/design-systems/registry";
import type { DesignSystem } from "../src/design-systems/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom 没有 IntersectionObserver；demo 预览的懒挂载需要它存在。
class ImmediateIntersectionObserver {
	constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
	observe(): void {
		this.callback([{ isIntersecting: true }]);
	}
	disconnect(): void {}
	unobserve(): void {}
}
vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);

function system(id: string, name: string): DesignSystem {
	return {
		id,
		name,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources: [],
		themeCss: "@theme { --color-primary: #000; }",
		designMd: `# ${name}`,
	};
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	setDesignSystems([system("linear", "Linear"), system("stripe", "Stripe")]);
});

afterEach(() => {
	act(() => root.unmount());
	vi.useRealTimers();
	host.remove();
	document.body.innerHTML = "";
	resetDesignSystems();
});

function render(node: React.ReactNode): void {
	act(() => root.render(node));
}

function tiles(): HTMLButtonElement[] {
	return [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
}

describe("DesignSystemGrid", () => {
	it("列出当前生效的全部风格", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles()).toHaveLength(2);
		expect(document.body.textContent).toContain("Linear");
		expect(document.body.textContent).toContain("Stripe");
	});

	it("跟在项目宫格之后时画分隔线，当首屏主角时不画", () => {
		render(<DesignSystemGrid divided busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("section")?.className).toContain("border-t");
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelector("section")?.className).not.toContain("border-t");
	});

	it("和项目卡片用同一套宫格，不是横向滚动条", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		const grid = document.body.querySelector("section > div");
		expect(grid?.className).toContain("grid");
		expect(grid?.className).not.toContain("overflow-x-auto");
	});

	it("点一张卡把对应的体系交回去", () => {
		const picked: string[] = [];
		render(<DesignSystemGrid busy={false} onPick={(s) => picked.push(s.id)} />);
		act(() => {
			tiles()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual(["stripe"]);
	});

	it("busy 时禁用，避免重复建项目", () => {
		const picked: string[] = [];
		render(<DesignSystemGrid busy onPick={(s) => picked.push(s.id)} />);
		expect(tiles().every((tile) => tile.disabled)).toBe(true);
		act(() => {
			tiles()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(picked).toEqual([]);
	});

	it("每张卡都有可读的无障碍名称", () => {
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual([
			"gallery.styles.view:Linear",
			"gallery.styles.view:Stripe",
		]);
	});

	function renderWithDemos(): void {
		vi.useFakeTimers();
		setDesignSystems([system("linear", "Linear"), system("stripe", "Stripe")].map((entry) => {
			const html = `<html><body>${entry.name}</body></html>`;
			return { ...entry, resources: [{ path: "demo.html", role: "demo", encoding: "text", content: html, bytes: html.length }] };
		}));
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
	}
	const frames = (): NodeListOf<HTMLIFrameElement> => host.querySelectorAll("iframe");
	function mouse(tile: HTMLButtonElement, type: string): void {
		act(() => { tile.dispatchEvent(new MouseEvent(type, { bubbles: true })); });
	}
	const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };

	it("idle and fly-by cards have no frames; sustained hover mounts only that demo", () => {
		renderWithDemos();
		expect(frames()).toHaveLength(0);
		mouse(tiles()[0], "mouseover");
		advance(100);
		expect(frames()).toHaveLength(0);
		mouse(tiles()[0], "mouseout");
		advance(200);
		expect(frames()).toHaveLength(0);
		mouse(tiles()[1], "mouseover");
		advance(160);
		expect(frames()).toHaveLength(1);
		expect(tiles()[1].querySelector("iframe")?.getAttribute("srcdoc")).toContain("Stripe");
		expect(frames()[0].tabIndex).toBe(-1);
		mouse(tiles()[1], "mouseout");
		expect(frames()).toHaveLength(0);
	});

	it("keyboard focus previews after a dwell, survives a pointer leaving, and clears on blur", () => {
		renderWithDemos();
		act(() => tiles()[0].focus());
		mouse(tiles()[0], "mouseover");
		mouse(tiles()[0], "mouseout");
		advance(159);
		expect(frames()).toHaveLength(0);
		advance(1);
		expect(tiles()[0].querySelector("iframe")).not.toBeNull();
		act(() => tiles()[1].focus());
		expect(frames()).toHaveLength(0);
		advance(160);
		expect(frames()).toHaveLength(1);
		expect(tiles()[1].querySelector("iframe")).not.toBeNull();
		act(() => tiles()[1].blur());
		expect(frames()).toHaveLength(0);
	});

	it("keyboard focus can take over from a parked pointer on another card", () => {
		renderWithDemos();
		mouse(tiles()[0], "mouseover");
		advance(160);
		expect(tiles()[0].querySelector("iframe")).not.toBeNull();
		act(() => tiles()[1].focus());
		expect(frames()).toHaveLength(0);
		advance(160);
		expect(frames()).toHaveLength(1);
		expect(tiles()[1].querySelector("iframe")).not.toBeNull();
	});
});

describe("目录拿不到时的状态", () => {
	it("还在拉时给骨架，不给空白", () => {
		resetDesignSystems();
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(tiles()).toHaveLength(0);
	});

	it("拉不到时给解释和重试按钮", () => {
		resetDesignSystems();
		act(() => markCatalogFailed());
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(document.body.textContent).toContain("gallery.styles.offline.title");
		expect(document.body.textContent).toContain("gallery.styles.retry");
		expect(document.body.querySelector('[aria-busy="true"]')).toBeNull();
	});

	it("已经有内容时失败不降级，照常显示列表", () => {
		act(() => markCatalogFailed());
		render(<DesignSystemGrid busy={false} onPick={() => {}} />);
		expect(tiles()).toHaveLength(2);
		expect(document.body.textContent).not.toContain("gallery.styles.offline.title");
	});
});
