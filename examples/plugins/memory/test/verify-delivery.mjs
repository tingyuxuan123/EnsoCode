// Opt-in, isolated Electron + fake-provider acceptance. Never targets a real profile.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../../../../.agents/skills/enso-cdp/scripts/cdp-core.mjs';
import { sessionAction } from '../../../../.agents/skills/enso-cdp/scripts/cdp-session.mjs';

const port = Number(process.env.ENSO_CDP_PORT);
const base = process.env.MEMORY_VERIFY_BASE;
const providerPort = Number(process.env.FAKE_PROVIDER_PORT);
assert.ok(port && port !== 9222 && base?.startsWith('/private/tmp/'));
assert.ok(Number.isInteger(providerPort) && providerPort > 1024);
const zip = resolve(process.argv[2] ?? '');
assert.ok(zip.endsWith('.zip'));
const pluginId = 'codekiln.memory';
const report = {
  projectIsolation: false,
  imageDelivery: false,
  agentDone: false,
  agentEdit: false,
  coldResume: false,
  runningFollowUp: false,
  projectPicker: false,
};
if (process.env.MEMORY_VERIFY_UI_ONLY === '1') {
  const prior = JSON.parse(await readFile(`${base}-artifacts/verification.json`, 'utf8'));
  for (const key of Object.keys(report))
    if (typeof prior[key] === 'boolean') report[key] = prior[key];
}
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const page = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const rpc = await connect(page.webSocketDebuggerUrl, { expectedPort: port, timeout: 120000 });
let frameRpc;
const evaluate = async (expression, target = rpc) => {
  const response = await target.send('Runtime.evaluate', {
    expression: `(async()=>(${expression}))()`,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.ok(!response.result?.exceptionDetails, JSON.stringify(response.result?.exceptionDetails));
  return response.result?.result?.value;
};
let lastCall = 0;
async function call(method, args = {}, workspace) {
  // Share the actual UI quota, never retry a rate-limited mutation.
  const remaining = 350 - (Date.now() - lastCall);
  if (remaining > 0) await new Promise((done) => setTimeout(done, remaining));
  lastCall = Date.now();
  const result = await evaluate(
    `window.electronAPI.extensionPlugins.call(${JSON.stringify({ pluginId, method: 'renderer.call', sessionId: null, ...(workspace !== undefined ? { workspace } : {}), payload: { method, args } })})`
  );
  assert.ok(result.ok, `${method}: ${JSON.stringify(result)}`);
  return result.value;
}
const history = (id) =>
  evaluate(
    `(${sessionAction.toString()})(window,${JSON.stringify({ command: 'session-read', id })})`
  );
const wait = (work) => waitUntil(work, { timeout: 60000, interval: 550 });
const screenshot = async (name) => {
  const { result } = await rpc.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${base}-artifacts/${name}.png`, Buffer.from(result.data, 'base64'));
};

try {
  if (process.env.MEMORY_VERIFY_UI_ONLY !== '1') {
    await evaluate(
      `(()=>{const el=document.createElement('input');el.type='file';el.hidden=true;el.id='memory-delivery-package';document.body.append(el)})()`
    );
    const document = await rpc.send('DOM.getDocument');
    const input = await rpc.send('DOM.querySelector', {
      nodeId: document.result.root.nodeId,
      selector: '#memory-delivery-package',
    });
    await rpc.send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [zip] });
    const staged = await evaluate(
      `window.electronAPI.extensionPlugins.stageFile(document.getElementById('memory-delivery-package').files[0])`
    );
    assert.ok(staged.ok && staged.preview.id === pluginId, JSON.stringify(staged));
    assert.ok(
      (
        await evaluate(
          `window.electronAPI.extensionPlugins.commit(${JSON.stringify(staged.preview.token)})`
        )
      ).ok
    );
    const installed = await evaluate('window.electronAPI.extensionPlugins.list()');
    if (installed.plugins.find((item) => item.id === pluginId)?.pending) {
      assert.ok(
        (
          await evaluate(
            `window.electronAPI.extensionPlugins.approvePending(${JSON.stringify(pluginId)})`
          )
        ).ok
      );
    }
    assert.ok(
      (
        await evaluate(
          `window.electronAPI.extensionPlugins.setEnabled(${JSON.stringify(pluginId)},true)`
        )
      ).ok
    );
    assert.ok(
      (
        await evaluate(
          `window.electronAPI.extensionPlugins.setCrossSessionInject(${JSON.stringify(pluginId)},true)`
        )
      ).ok
    );
    await call('settings', { autoLearn: false, summarizeOnEnd: false });
    const a = await evaluate(
      `window.__stores.settings.getState().addProject(${JSON.stringify(`${base}-proj`)})`
    );
    const b = await evaluate(
      `window.__stores.settings.getState().addProject(${JSON.stringify(`${base}-b`)})`
    );
    const wa = { projectId: a.id },
      wb = { projectId: b.id };
    const target = await evaluate(
      `window.__stores.sessions.getState().newConversation(${JSON.stringify(a.id)},{forceNew:true})`
    );
    const editTarget = await evaluate(
      `window.__stores.sessions.getState().newConversation(${JSON.stringify(a.id)},{forceNew:true})`
    );
    assert.ok(target && editTarget && target !== editTarget);
    await call('save', { content: 'PROJECT_A_ONLY' }, wa);
    await call('save', { content: 'PROJECT_B_ONLY' }, wb);
    await call('save', { content: 'GLOBAL_ONLY', scope: 'global' }, wa);
    assert.deepEqual((await call('read', {}, wb)).items.map((row) => row.content).sort(), [
      'GLOBAL_ONLY',
      'PROJECT_B_ONLY',
    ]);
    assert.deepEqual(
      (await call('read', {}, null)).items.map((row) => row.content),
      ['GLOBAL_ONLY']
    );
    report.projectIsolation = true;

    const image = await call('attachment_save', { data: png, thumb: png }, wa);
    const task = (
      await call(
        'scratchpad',
        { action: 'add', text: '图片投递和Agent完成回写', images: [image.id] },
        wa
      )
    ).added;
    const marker = `DELIVERY_${randomUUID()}`;
    const result = await call(
      'send_todo',
      {
        id: task.id,
        sessionId: target,
        deliveryId: randomUUID(),
        note: `${marker} [[tool:plugin_codekiln-memory__scratchpad ${JSON.stringify({ action: 'done', id: task.id })}]]`,
      },
      wa
    );
    assert.equal(result.ok, true);
    await wait(async () =>
      (await call('scratchpad', { action: 'list' }, wa)).items.some(
        (row) => row.id === task.id && row.status === 'done'
      )
    );
    const authoritative = await history(target);
    assert.ok(authoritative.ok && JSON.stringify(authoritative.history.messages).includes(marker));
    report.agentDone = true;
    const requests = await (await fetch(`http://127.0.0.1:${providerPort}/__requests`)).json();
    assert.ok(
      requests.requests.some((entry) =>
        entry.lastUserImages?.some(
          (part) =>
            part.sha256 === createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex')
        )
      )
    );
    report.imageDelivery = true;

    const edited = (await call('scratchpad', { action: 'add', text: 'Agent编辑验收' }, wa)).added;
    await call(
      'send_todo',
      {
        id: edited.id,
        sessionId: editTarget,
        deliveryId: randomUUID(),
        note: `EDIT_MARKER [[tool:plugin_codekiln-memory__scratchpad ${JSON.stringify({ action: 'edit', id: edited.id, text: 'AGENT_EDIT_CONFIRMED', status: 'doing' })}]]`,
      },
      wa
    );
    await wait(async () =>
      (await call('scratchpad', { action: 'list' }, wa)).items.some(
        (row) => row.id === edited.id && row.text === 'AGENT_EDIT_CONFIRMED'
      )
    );
    report.agentEdit = true;

    const released = await evaluate(`window.electronAPI.agent.release(${JSON.stringify(target)})`);
    assert.ok(released.ok, JSON.stringify(released));
    await wait(() =>
      evaluate(
        `window.__stores.sessions.getState().conversations[${JSON.stringify(target)}]?.started === false`
      )
    );
    const cold = (await call('scratchpad', { action: 'add', text: '冷会话恢复验收' }, wa)).added;
    await call(
      'send_todo',
      { id: cold.id, sessionId: target, deliveryId: randomUUID(), note: 'MEMORY_HOLD_COLD_MARKER' },
      wa
    );
    await wait(async () =>
      JSON.stringify((await history(target)).history?.messages).includes('MEMORY_HOLD_COLD_MARKER')
    );
    report.coldResume = true;
    const follow = (await call('scratchpad', { action: 'add', text: '运行中排队验收' }, wa)).added;
    await call(
      'send_todo',
      {
        id: follow.id,
        sessionId: target,
        deliveryId: randomUUID(),
        note: 'FOLLOW_UP_MARKER',
        deliverAs: 'followUp',
      },
      wa
    );
    await wait(async () =>
      JSON.stringify((await history(target)).history?.messages).includes('FOLLOW_UP_MARKER')
    );
    report.runningFollowUp = true;
    await writeFile(`${base}-artifacts/verification.json`, JSON.stringify(report, null, 2));
  }

  const rail = '[data-rail-view="plugin:codekiln.memory:memory"]';
  await evaluate(
    `(()=>{const rail=document.querySelector(${JSON.stringify(rail)});if(rail.getAttribute('aria-pressed')!=='true')rail.click()})()`
  );
  await wait(() => evaluate('!!document.querySelector(\'[data-slot="plugin-workspace"] iframe\')'));
  const frame = await wait(async () =>
    (await fetchJson(port, '/json/list')).find(
      (entry) => entry.type === 'iframe' && entry.url.includes('plugin-view.html')
    )
  );
  frameRpc = await connect(frame.webSocketDebuggerUrl, { expectedPort: port, timeout: 60000 });
  const frameEval = (expression) => evaluate(expression, frameRpc);
  await wait(() => frameEval('document.getElementById("project-switch").options.length === 3'));
  await rpc.send('Page.bringToFront');
  assert.equal(await evaluate('document.hasFocus()'), true, 'MANUAL_FOCUS_REQUIRED');
  const clickFrame = async (expression) => {
    const rect = await frameEval(
      `(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
    );
    const offset = await evaluate(
      `(()=>{const r=document.querySelector('iframe[name="enso-plugin-view"]').getBoundingClientRect();return {x:r.x,y:r.y}})()`
    );
    const x = rect.x + offset.x,
      y = rect.y + offset.y;
    await rpc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await rpc.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await rpc.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  };
  await clickFrame(`document.querySelector('[data-tab="memory"]')`);
  await clickFrame(`document.getElementById('project-control')`);
  await wait(() => frameEval(`document.getElementById('project-dialog').open`));
  await clickFrame(
    `[...document.querySelectorAll('.project-choice')].find(option=>option.textContent.endsWith('-b'))`
  );
  await wait(async () =>
    (await frameEval('document.getElementById("items").textContent')).includes('PROJECT_B_ONLY')
  );
  assert.ok(
    !(await frameEval('document.getElementById("items").textContent')).includes('PROJECT_A_ONLY')
  );
  report.projectPicker = true;
  await screenshot('memory-project-b');
  await clickFrame(`document.getElementById('project-control')`);
  await wait(() => frameEval(`document.getElementById('project-dialog').open`));
  await screenshot('memory-project-picker');
  await clickFrame(
    `[...document.querySelectorAll('.project-choice')].find(option=>option.textContent.endsWith('-proj'))`
  );
  await wait(async () =>
    (await frameEval('document.getElementById("items").textContent')).includes('PROJECT_A_ONLY')
  );
  const pickedContext = await frameEval(
    `JSON.parse(document.getElementById('project-switch').value)`
  );
  const uiMarker = `UI_CLICK_${randomUUID()}`;
  const uiTask = (await call('scratchpad', { action: 'add', text: uiMarker }, pickedContext)).added;
  await clickFrame(`document.querySelector('[data-tab="todos"]')`);
  await frameEval(
    `(()=>{const filter=document.getElementById('todo-filter');filter.value='todo';filter.dispatchEvent(new Event('change'));return true})()`
  );
  await wait(() =>
    frameEval(
      `!![...document.querySelectorAll('.todo')].find(row=>row.querySelector('.todo__text').textContent===${JSON.stringify(uiMarker)})`
    )
  );
  await clickFrame(
    `[...document.querySelectorAll('.todo')].find(row=>row.querySelector('.todo__text').textContent===${JSON.stringify(uiMarker)}).querySelector('[aria-label="发到会话"]')`
  );
  await wait(() =>
    frameEval(
      `document.getElementById('send-dialog').open && !!document.querySelector('#send-list input:checked')`
    )
  );
  const uiTarget = await frameEval(`document.querySelector('#send-list input:checked').value`);
  await screenshot('memory-send-dialog');
  await clickFrame(`document.getElementById('send-go')`);
  await wait(() =>
    frameEval(
      `!document.getElementById('send-dialog').open && document.getElementById('notice').textContent.includes('确认接收')`
    )
  );
  assert.equal(
    (await call('scratchpad', { action: 'list' }, pickedContext)).items.find(
      (row) => row.id === uiTask.id
    ).status,
    'doing'
  );
  await wait(async () =>
    JSON.stringify((await history(uiTarget)).history?.messages).includes(uiMarker)
  );
  report.realUiSend = true;
  await screenshot('memory-todos');
  console.log(JSON.stringify(report));
  await writeFile(`${base}-artifacts/verification.json`, JSON.stringify(report, null, 2));
} finally {
  frameRpc?.close();
  rpc.close();
}
