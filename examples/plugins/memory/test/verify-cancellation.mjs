// Explicit, paid two-vendor SDK cancellation check. Never installs into the user's real profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../../../../.agents/skills/enso-cdp/scripts/cdp-core.mjs';
import { sessionAction } from '../../../../.agents/skills/enso-cdp/scripts/cdp-session.mjs';

const port = Number(process.env.ENSO_CDP_PORT),
  project = process.env.MEMORY_VERIFY_PROJECT;
assert.ok(port && port !== 9222 && project?.startsWith('/private/tmp/'));
assert.equal(
  process.env.ENSO_VERIFY_REAL_MODELS,
  '1',
  'Real model requests require explicit opt-in'
);
await mkdir(project, { recursive: true });
assert.equal(await realpath(project), project);
const fixture = await mkdtemp(join(await realpath(tmpdir()), 'memory-cancel-proof-'));
const root = join(fixture, 'plugin');
const rpc = await connect(
  selectPage(await fetchJson(port, '/json/list'), 'index.html').webSocketDebuggerUrl,
  { expectedPort: port, timeout: 180000 }
);
async function evaluate(expression) {
  const response = await rpc.send('Runtime.evaluate', {
    expression: `window.__memoryCancellationProof=Promise.resolve().then(()=>(${expression}))`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.ok(!response.result?.exceptionDetails, JSON.stringify(response.result?.exceptionDetails));
  return response.result.result.value;
}
const api = (method, ...args) =>
  evaluate(`window.electronAPI.extensionPlugins.${method}(...${JSON.stringify(args)})`);
const id = 'codekiln.memoryproof';
const report = [];
try {
  const source = new URL('../', import.meta.url);
  await mkdir(root);
  for (const name of [
    'automation.mjs',
    'domain.mjs',
    'params.mjs',
    'service.mjs',
    'storage.mjs',
    'memory.html',
    'icon.svg',
  ])
    await cp(new URL(name, source), join(root, name));
  await cp(new URL('main.mjs', source), join(root, 'memory-main.mjs'));
  const manifest = JSON.parse(await readFile(new URL('enso-plugin.json', source), 'utf8'));
  manifest.id = id;
  manifest.name = 'Memory cancellation proof';
  manifest.contributes.methods.push({ name: 'verify_cancel', timeoutMs: 25000 });
  await writeFile(join(root, 'enso-plugin.json'), JSON.stringify(manifest, null, 2));
  // Only instrumentation changes: run the real source, real agent.run, and real cancellation wire.
  // Capture notifications instead of displaying test alerts in the user's Notification Center.
  await writeFile(
    join(root, 'main.mjs'),
    `import {activate as memory} from './memory-main.mjs';
export function activate(enso) {
  const events=new Map(),methods=new Map(),notices=[];let cancelNext=false,requests=0;
  memory({...enso,events:{on:(name,fn)=>{events.set(name,fn);return enso.events.on(name,fn)}},renderer:{handle:(name,fn)=>{methods.set(name,fn);return enso.renderer.handle(name,fn)}},ui:{...enso.ui,notify:async(...args)=>{notices.push(args)}},agent:{...enso.agent,run:(input)=>{
    requests++;if(!cancelNext)return enso.agent.run(input);cancelNext=false;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1500);
    return enso.agent.run({...input,signal:AbortSignal.any([input.signal,controller.signal])}).finally(()=>clearTimeout(timer));
  }}});
  enso.renderer.handle('verify_cancel',async(_,ctx)=>{
    await methods.get('settings')({autoLearn:false,summarizeOnEnd:false},ctx);
    await events.get('before_agent_start')({kind:'user',prompt:'仅用于验证取消不会写入记忆'},ctx);
    await events.get('agent_end')({text:'隔离取消链路验证'},ctx);
    notices.length=0;const before=requests;cancelNext=true;
    const result=await methods.get('analyze')({},ctx);
    const records=await methods.get('read')({target:'long_term'},ctx);
    return {result,notices:[...notices],requests:requests-before,records:records.count};
  });
}`
  );
  const zip = join(fixture, 'proof.zip');
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../../../scripts/plugin-author.mjs', import.meta.url)),
      'pack',
      root,
      '--out',
      zip,
    ],
    { stdio: 'pipe', timeout: 60000 }
  );
  await evaluate(
    `(()=>{const input=document.createElement('input');input.type='file';input.id='memory-cancel-zip';document.body.append(input)})()`
  );
  const doc = await rpc.send('DOM.getDocument');
  const node = await rpc.send('DOM.querySelector', {
    nodeId: doc.result.root.nodeId,
    selector: '#memory-cancel-zip',
  });
  await rpc.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [zip] });
  const staged = await evaluate(
    `window.electronAPI.extensionPlugins.stageFile(document.getElementById('memory-cancel-zip').files[0])`
  );
  assert.ok(staged.ok, JSON.stringify(staged));
  assert.ok((await api('commit', staged.preview.token)).ok);
  const p = await evaluate(
    `window.__stores.settings.getState().addProject(${JSON.stringify(project)})`
  );
  const selection = await evaluate('window.__stores.settings.getState().defaultModel');
  const wanted = (process.env.MEMORY_PROOF_MODELS ?? 'auto/deepseek-v4.1-flash,auto/gpt-6.1-sol')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const modelId of wanted) {
    const sessionId = await evaluate(
      `window.__stores.sessions.getState().newConversation(${JSON.stringify(p.id)},{forceNew:true})`
    );
    assert.ok(sessionId);
    const set = await api('configSet', id, { model: `${selection.providerId}::${modelId}` });
    assert.ok(set.ok, JSON.stringify(set));
    const sent = await evaluate(
      `(${sessionAction.toString()})(window,${JSON.stringify({ command: 'session-send', id: sessionId, text: '请只回复 OK，不调用任何工具。', providerId: selection.providerId, modelId })})`
    );
    assert.ok(sent.accepted, JSON.stringify(sent));
    // The warm-up only proves the session and credentials are usable. Some gateways stream an
    // empty assistant body for this one-line request; that does not change the cancellation path.
    let warmed = true;
    try {
      await waitUntil(
        async () => {
          const state = await evaluate(
            `(${sessionAction.toString()})(window,${JSON.stringify({ command: 'session-state', id: sessionId, afterSeq: sent.afterSeq })})`
          );
          assert.ok(!state.waiting, `Manual action required: ${JSON.stringify(state)}`);
          if (state.complete) return true;
        },
        { timeout: 90000, interval: 500 }
      );
    } catch (error) {
      warmed = false;
      console.log(
        `NOTE ${modelId}: warm-up did not settle (${error.message}); the real agent.run proof still runs`
      );
    }
    const response = await api('call', {
      pluginId: id,
      sessionId,
      method: 'renderer.call',
      payload: { method: 'verify_cancel', args: {} },
    });
    assert.ok(response.ok, JSON.stringify(response));
    const result = response.value;
    assert.deepEqual(result.result, { skipped: true, reason: 'cancelled' });
    assert.equal(result.requests, 1);
    assert.equal(result.notices.length, 0);
    assert.equal(result.records, 0);
    report.push({
      modelId,
      warmUpSettled: warmed,
      realAgentRunCancelled: true,
      notifications: 0,
      writes: 0,
    });
    console.log(`PASS ${modelId}: actual SDK abort is quiet and does not persist a result`);
  }
  await writeFile(
    '/private/tmp/memory-cancellation-verification.json',
    JSON.stringify(report, null, 2)
  );
} finally {
  rpc.close();
  await rm(fixture, { recursive: true, force: true });
}
