// Requires an ISOLATED dev profile with test/fixtures/plugin-agent-run installed.
// This sends real paid model requests only with ENSO_VERIFY_REAL_MODELS=1.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';

assert.equal(
  process.env.ENSO_VERIFY_REAL_MODELS,
  '1',
  'Explicit real-model verification opt-in required'
);
const port = Number(process.env.ENSO_CDP_PORT || 9333);
assert.ok(port !== 9222 && port > 0 && port < 65536, 'Use an isolated non-default CDP port');
const projectPath = '/private/tmp/collabra-upstream-port-project';
const pluginId = 'collabra.verify.agent';
const page = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const rpc = await connect(page.webSocketDebuggerUrl, { expectedPort: port, timeout: 150000 });
const proof = readFileSync(`${projectPath}/README.md`, 'utf8');
const reports = [];
async function evaluate(expression) {
  const response = await rpc.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
}
async function call(method, args = {}) {
  const result = await evaluate(
    `window.electronAPI.extensionPlugins.call(${JSON.stringify({
      pluginId,
      method: 'renderer.call',
      payload: { method, args },
      sessionId: session.id,
    })})`
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
let session;
try {
  session = await evaluate(`(async()=>{
    const settings=window.__stores.settings.getState(), sessions=window.__stores.sessions.getState();
    const project=settings.projects.find(p=>p.path===${JSON.stringify(projectPath)});
    if(!project) throw Error('Isolated verification project missing');
    const id=window.__portSession??window.__stores.sessions.getState().activeId;
    const c=window.__stores.sessions.getState().conversations[id];
    if(c?.projectId!==project.id||!c.started) throw Error('Start a verified parent session first');
    return {id,providerId:settings.defaultModel.providerId,messages:c.messages.length,model:c.lastModelId};
  })()`);
  for (const [model, context] of [
    ['auto/deepseek-v4.1-flash', 'none'],
    ['auto/gpt-6.1-sol', 'conversation'],
    ['auto/deepseek-v4.1-flash', 'fork'],
  ]) {
    const chosen = model === session.model ? 'session' : `${session.providerId}::${model}`;
    assert.ok(
      (
        await evaluate(
          `window.electronAPI.extensionPlugins.configSet(${JSON.stringify(pluginId)},{model:${JSON.stringify(chosen)}})`
        )
      ).ok
    );
    const existing = await call('result');
    if (existing?.state === 'running') {
      await call('cancel');
      await waitUntil(async () => (await call('result'))?.state !== 'running', {
        timeout: 15000,
        interval: 500,
      });
    }
    const before = await evaluate(
      `window.__stores.sessions.getState().conversations[${JSON.stringify(session.id)}].messages.length`
    );
    await call('start', {
      prompt:
        'Call the read tool exactly once on README.md in the current workspace, then reply with only the Proof token from that file. Never modify files. Do not run commands.',
      context,
    });
    let result;
    await waitUntil(
      async () => {
        result = await call('result');
        return result?.state !== 'running';
      },
      { timeout: 150000, interval: 500 }
    );
    assert.equal(result.state, 'completed', JSON.stringify(result));
    assert.ok(
      result.value.text.includes('COLLABRA_READONLY_AGENT_PROOF_20261115'),
      JSON.stringify(result)
    );
    assert.equal(result.value.model, model);
    assert.ok(
      result.events.some((e) => e.type === 'tool-start' && e.name === 'read'),
      JSON.stringify(result)
    );
    const after = await evaluate(
      `window.__stores.sessions.getState().conversations[${JSON.stringify(session.id)}].messages.length`
    );
    assert.equal(after, before, 'Side agent must not append to parent transcript');
    assert.equal(
      readFileSync(`${projectPath}/README.md`, 'utf8'),
      proof,
      'Readonly file was modified'
    );
    reports.push({
      model,
      context,
      toolStarts: result.events.filter((e) => e.type === 'tool-start').map((e) => e.name),
      parentMessagesUnchanged: true,
      text: result.value.text,
    });
  }
  await call('open');
  await waitUntil(
    () =>
      evaluate(
        `Boolean(document.querySelector('[data-enso="plugin-view"]')||[...document.querySelectorAll('.dv-tab')].some(e=>e.textContent.includes('Readonly agent proof')))`
      ),
    { timeout: 15000 }
  );
  await call('close');
  await waitUntil(
    () =>
      evaluate(
        `![...document.querySelectorAll('.dv-tab')].some(e=>e.textContent.includes('Readonly agent proof'))`
      ),
    { timeout: 15000 }
  );
  const mute = await evaluate(`(()=>{
    const s=window.__stores.sessions, id=${JSON.stringify(session.id)};
    if(s.getState().conversations[id].muted===true)s.getState().toggleMuteConversation(id);
    const before=s.getState().conversations[id]; const fields=['messages','status','unread','pendingAsks','pendingApprovals'];
    const snapshot=JSON.stringify(fields.map(k=>before[k]));
    s.getState().toggleMuteConversation(id);
    const after=s.getState().conversations[id];
    return {muted:after.muted===true,unchanged:JSON.stringify(fields.map(k=>after[k]))===snapshot};
  })()`);
  assert.deepEqual(mute, { muted: true, unchanged: true });
  await waitUntil(() => evaluate(`Boolean(document.querySelector('[data-muted="true"]'))`), {
    timeout: 10000,
  });
  assert.ok((await evaluate(`window.electronAPI.agent.release(${JSON.stringify(session.id)})`)).ok);
  await waitUntil(
    () =>
      evaluate(
        `!window.__stores.sessions.getState().conversations[${JSON.stringify(session.id)}].started`
      ),
    { timeout: 15000 }
  );
  await call('start', {
    prompt: 'Read README.md once, then reply with only its Proof token. Do not modify files.',
    context: 'none',
  });
  let cold;
  await waitUntil(
    async () => {
      cold = await call('result');
      return cold?.state !== 'running';
    },
    { timeout: 150000, interval: 500 }
  );
  assert.equal(cold.state, 'completed', JSON.stringify(cold));
  assert.ok(cold.value.text.includes('COLLABRA_READONLY_AGENT_PROOF_20261115'));
  const output = { reports, viewOpenClose: true, mute, coldSessionWake: true };
  writeFileSync(
    '/private/tmp/collabra-upstream-port-verification.json',
    JSON.stringify(output, null, 2)
  );
  console.log(JSON.stringify(output, null, 2));
} finally {
  rpc.close();
}
