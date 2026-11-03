/**
 * Real-Chromium regression: native scrolling must not move canvas chrome.
 * In an isolated dev instance, open a .vetd with a frame larger than its viewport,
 * then run ENSO_CDP_PORT=9333 node scripts/check-design-canvas-viewport.mjs.
 * No model calls, files or design coordinates are changed. happy-dom has no layout.
 */
import assert from 'node:assert/strict';
import { connect, fetchJson, selectPage } from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';

const port = Number(process.env.ENSO_CDP_PORT);
assert(
  Number.isInteger(port) && port > 0 && port <= 65535 && port !== 9222,
  'Use an explicit isolated ENSO_CDP_PORT (not the user profile on 9222)'
);
const page = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const cdp = await connect(page.webSocketDebuggerUrl, { expectedPort: port });
try {
  const { result } = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(${function check() {
      const canvas = document.querySelector(
        '[data-design-panel] [role="application"].vetd-canvas-bg'
      );
      if (!canvas?.checkVisibility()) throw new Error('Open the isolated design canvas first');
      const frame = canvas.querySelector('[data-vetd-frame]');
      const corner = canvas.querySelector(':scope > .right-3');
      const dock = canvas.querySelector(':scope > div.bottom-3');
      if (!frame || !corner || !dock) throw new Error('Missing frame or canvas chrome');
      if (canvas.scrollWidth <= canvas.clientWidth && canvas.scrollHeight <= canvas.clientHeight)
        throw new Error('Use an oversized frame so the regression cannot pass vacuously');
      const originalScroll = [canvas.scrollLeft, canvas.scrollTop];
      const focused = document.activeElement;
      const probe = document.createElement('button');
      probe.style.cssText =
        'position:absolute;left:2400px;top:1600px;width:10px;height:10px;opacity:0;pointer-events:none';
      const position = () =>
        [corner, dock].flatMap((element) => {
          const box = element.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        });
      canvas.scrollTo(0, 0);
      const before = position();
      const samples = [];
      try {
        canvas.append(probe);
        for (const [name, action] of [
          [
            'scrollIntoView',
            () => frame.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
          ],
          ['offscreen focus', () => probe.focus()],
          ['scrollTo', () => canvas.scrollTo(300, 200)],
        ]) {
          action();
          const sample = {
            name,
            scroll: [canvas.scrollLeft, canvas.scrollTop],
            position: position(),
          };
          samples.push(sample);
          if (
            sample.scroll.some((value) => value !== 0) ||
            sample.position.some((value, index) => Math.abs(value - before[index]) > 0.1)
          )
            throw new Error(JSON.stringify({ before, failed: sample }));
        }
        return { overflow: getComputedStyle(canvas).overflow, before, samples };
      } finally {
        probe.remove();
        if (focused instanceof HTMLElement && focused.isConnected)
          focused.focus({ preventScroll: true });
        canvas.scrollTo(...originalScroll);
      }
    }.toString()})()`,
  });
  assert(
    !result.exceptionDetails,
    result.exceptionDetails?.exception?.description ?? 'Browser regression failed'
  );
  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  cdp.close();
}
