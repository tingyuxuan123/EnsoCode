// 在隔离 dev 实例中验证置顶项目的真实 CSS 布局，不改用户项目或偏好。
import assert from 'node:assert/strict';

const port = process.env.ENSO_CDP_PORT;
assert.ok(port && port !== '9222', 'Use an isolated dev instance on a separate CDP port');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
assert.ok(page, 'EnsoCode main window not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (response) =>
      response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result)
    );
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
let nodeId;
try {
  await send('DOM.enable');
  await send('CSS.enable');
  const { root } = await send('DOM.getDocument');
  const found = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.group:has(> [data-slot="menu-trigger"]):has(> span[aria-hidden="true"])',
  });
  nodeId = found.nodeId;
  assert.ok(nodeId, 'Seed a pinned project in the isolated instance first');
  const measure = () =>
    evaluate(`(() => {
      const row = document.querySelector('.group:has(> [data-slot="menu-trigger"]):has(> span[aria-hidden="true"])');
      const marker = row.querySelector(':scope > span[aria-hidden="true"]');
      const trigger = row.querySelector('[data-slot="menu-trigger"]');
      return { markerWidth: marker.getBoundingClientRect().width, triggerX: trigger.getBoundingClientRect().x };
    })()`);
  await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  const idle = await measure();
  await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
  const hover = await measure();
  assert.ok(idle.markerWidth > 0, 'Pin marker must reserve space');
  assert.equal(hover.markerWidth, idle.markerWidth, 'Hover must preserve pin marker width');
  assert.equal(hover.triggerX, idle.triggerX, 'Losing row hover must not move the menu trigger');
  console.log('pinned project menu layout passed', { idle, hover });
} finally {
  if (nodeId) await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  ws.close();
}
