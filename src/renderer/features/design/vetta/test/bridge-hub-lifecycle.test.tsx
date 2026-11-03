/**
 * 画布的 bridge 回调随状态换引用（frameIds 随视口裁剪重排 → refreshAll → storageChanged）。
 * 以前每换一次就 stop/start 一轮：stop 清掉所有 frame 的 iframe 登记，而 FrameView 的
 * 注册 effect 不会因此重跑。于是元素选中的消息认不出来源（选不中元素），截图报
 * `frame not mounted`。回调换引用只能换回调，登记与挂起的截图都得留着。
 */
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BridgeHub, type BridgeHubEvents } from "../src/canvas/bridge-client";
import { useBridgeEvents } from "../src/canvas/use-bridge-events";
import { type NavBridge, useNavBridge } from "../src/interaction/nav-bridge";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function events(overrides: Partial<BridgeHubEvents> = {}): BridgeHubEvents {
	const noop = () => {};
	return {
		onSelected: noop,
		onExitInspect: noop,
		onHmrUpdated: noop,
		onRendered: noop,
		onFrameError: noop,
		onFrameContextMenu: noop,
		onFrameWheel: noop,
		onFrameSpace: noop,
		onStorage: noop,
		...overrides,
	};
}

function Harness({ bridge, handlers }: { bridge: BridgeHub; handlers: BridgeHubEvents }) {
	useBridgeEvents(bridge, handlers);
	return null;
}

const ORIGIN = "http://127.0.0.1:5179";
function fromFrame(iframe: HTMLIFrameElement, data: Record<string, unknown>, origin = ORIGIN): void {
	window.dispatchEvent(new MessageEvent("message", { data: { vetd: true, ...data }, source: iframe.contentWindow, origin }));
}

function fakeFrame(): HTMLIFrameElement {
	const iframe = document.createElement("iframe");
	iframe.src = `${ORIGIN}/home`;
	Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: vi.fn() } });
	return iframe;
}

afterEach(() => {
	document.body.innerHTML = "";
});

it("keeps frame registrations and in-flight captures when the callbacks change", async () => {
	const bridge = new BridgeHub();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const first = vi.fn();
	act(() => root.render(<Harness bridge={bridge} handlers={events({ onSelected: first })} />));

	const iframe = fakeFrame();
 // The fake frame is intentionally detached: happy-dom does not load iframe pages.
	bridge.register("home", iframe);
	fromFrame(iframe, { type: "ready", frameId: "home" });
 // happy-dom 21 dispatches postMessage differently. Observe the outbound payload
 // synchronously rather than relying on iframe task scheduling.
 const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
 const pending = bridge.capture("home", { timeoutMs: 5_000 });
 await Promise.resolve();
 const requestId = (post.mock.calls.at(-1)?.[0] as { requestId: string }).requestId;

	// 画布状态一变，回调换了一份新引用。
	const second = vi.fn();
	act(() => root.render(<Harness bridge={bridge} handlers={events({ onSelected: second })} />));

	fromFrame(iframe, { type: "selected", payload: null });
	expect(first).not.toHaveBeenCalled();
	expect(second).toHaveBeenCalledWith("home", null);

	fromFrame(iframe, { type: "captured", requestId, dataUrl: "data:image/png;base64,AA==" });
	await expect(pending).resolves.toBe("data:image/png;base64,AA==");

	act(() => root.unmount());
	// 卸载才真正停：之后的消息不再派发。
	fromFrame(iframe, { type: "selected", payload: null });
	expect(second).toHaveBeenCalledTimes(1);
});

it("requires the registered WindowProxy and origin for all canvas events, and posts to that origin only", () => {
	const bridge = new BridgeHub();
	const onSelected = vi.fn(), onHmrUpdated = vi.fn(), onFrameSpace = vi.fn();
	const iframe = fakeFrame();
	bridge.start(events({ onSelected, onHmrUpdated, onFrameSpace }));
	bridge.register("home", iframe);
	try {
		fromFrame(iframe, { type: "selected" }, "https://evil.example");
		fromFrame(iframe, { type: "selected" }, "http://127.0.0.1:5180");
		fromFrame(iframe, { type: "selected", vetd: false });
		fromFrame(fakeFrame(), { type: "hmr-updated" });
		fromFrame(fakeFrame(), { type: "space", down: true });
		expect(onSelected).not.toHaveBeenCalled();
		expect(onHmrUpdated).not.toHaveBeenCalled();
		expect(onFrameSpace).not.toHaveBeenCalled();
		fromFrame(iframe, { type: "selected" });
		expect(onSelected).toHaveBeenCalledWith("home", null);
		bridge.setRadius("home", 16);
		expect(iframe.contentWindow!.postMessage).toHaveBeenCalledWith({ vetd: true, type: "frame-radius", radius: 16 }, ORIGIN);
	} finally { bridge.stop(); }
});

it("requires matching source and loopback origin in interaction mode", () => {
	const iframe = fakeFrame();
	const iframeRef = { current: iframe };
	let nav: NavBridge | undefined;
	function NavHarness() { nav = useNavBridge(iframeRef); return null; }
	const host = document.createElement("div");
	const root = createRoot(host);
	try {
		act(() => root.render(<NavHarness />));
		act(() => {
			fromFrame(iframe, { type: "navigated", path: "/spoof" }, "http://127.0.0.1:5180");
			fromFrame(fakeFrame(), { type: "navigated", path: "/wrong-source" });
			fromFrame(iframe, { type: "navigated", path: "/wrong-tag", vetd: false });
		});
		expect(nav?.nav).toBeNull();
		act(() => fromFrame(iframe, { type: "navigated", path: "/home" }));
		expect(nav?.nav?.path).toBe("/home");
		nav?.navigateTo("/login");
		expect(iframe.contentWindow!.postMessage).toHaveBeenCalledWith({ vetd: true, type: "navigate", to: "/login" }, ORIGIN);
	} finally { act(() => root.unmount()); }
});
