import { waitUntil } from './cdp-core.mjs';

// Self-contained for Runtime.evaluate and fake DOM tests.
export function domReady(win, doc, getStyle, selector, requireStores = false) {
  if (
    doc.readyState === 'loading' ||
    !win.electronAPI?.agent ||
    (requireStores && (!win.__stores?.sessions?.getState || !win.__stores?.settings?.getState))
  )
    return { ready: false, reason: 'DOM/preload/stores not ready' };
  if (!selector) return { ready: true };
  const elements = doc.querySelectorAll(selector);
  if (elements.length > 1) throw new Error(`AMBIGUOUS_SELECTOR: ${elements.length} matches`);
  const el = elements[0];
  if (!el) return { ready: false, reason: 'selector missing' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const style = getStyle(el);
  const box = el.getBoundingClientRect();
  const ready =
    el.isConnected &&
    !el.disabled &&
    el.getAttribute?.('aria-disabled') !== 'true' &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    Number(style.opacity) !== 0 &&
    box.width > 0 &&
    box.height > 0 &&
    el.getClientRects().length > 0;
  return {
    ready: Boolean(ready),
    reason: ready ? undefined : 'element hidden/disabled/zero box',
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

export const readyExpression = (selector, requireStores = false) =>
  `(${domReady.toString()})(window,document,getComputedStyle,${JSON.stringify(selector)},${requireStores})`;
export const focusExpression =
  '({visible:document.visibilityState === "visible",focused:document.hasFocus()})';

export function browserPid(info) {
  const processes = info?.result?.processInfo?.filter((p) => p.type === 'browser') ?? [];
  return processes.length === 1 && Number.isSafeInteger(processes[0].id) && processes[0].id > 0
    ? processes[0].id
    : null;
}

export async function checkFocus(ctx) {
  const state = await ctx.evaluate(focusExpression);
  if (!state?.visible || !state.focused)
    throw new Error(
      'MANUAL_FOCUS_REQUIRED: input dispatched but target did not retain focus; outcome unknown, do not automatically retry'
    );
}

export async function ensureFocus(ctx) {
  await ctx.send('Page.bringToFront');
  let state = await ctx.evaluate(focusExpression);
  if (state?.visible && state.focused) return;
  if (ctx.activate) await ctx.activate();
  state = await ctx.evaluate(focusExpression);
  if (!state?.visible || !state.focused)
    throw new Error(
      'MANUAL_FOCUS_REQUIRED: focus the target EnsoCode window and retry manually; visibility alone is not focus'
    );
}

export async function click(
  ctx,
  selector,
  { button = 'left', timeout = 30_000, interval = 100 } = {}
) {
  await waitUntil(
    async () => {
      const state = await ctx.evaluate(readyExpression(selector));
      return state?.ready && state;
    },
    { timeout, interval }
  );
  await ensureFocus(ctx);
  // Recheck after focus/scroll: never dispatch at an old or hidden box.
  const state = await ctx.evaluate(readyExpression(selector));
  if (!state?.ready) throw new Error('ELEMENT_NOT_READY: layout changed before click');
  const x = state.box.x + state.box.width / 2;
  const y = state.box.y + state.box.height / 2;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await ctx.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'mouse',
    });
  }
  await checkFocus(ctx);
  return { ok: true, clicked: true, focused: true, button, x, y };
}
