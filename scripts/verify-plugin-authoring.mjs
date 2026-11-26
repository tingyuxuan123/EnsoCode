// Opt-in isolated desktop verification. Does not publish, use the real profile, or auto-grant asks.
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';
import { sessionAction } from '../.agents/skills/enso-cdp/scripts/cdp-session.mjs';

const port = Number(process.env.ENSO_CDP_PORT),
  project = process.env.AUTHORING_VERIFY_PROJECT;
assert.ok(
  port && port !== 9222 && project?.startsWith('/private/tmp/'),
  'Use a verified isolated port and /private/tmp/ project'
);
assert.equal(
  process.env.AUTHORING_TRUST_FIXTURES,
  '1',
  'Explicitly trust and execute only these generated test fixtures'
);
await mkdir(project, { recursive: true });
assert.equal(await realpath(project), project);
const page = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const rpc = await connect(page.webSocketDebuggerUrl, { expectedPort: port, timeout: 180000 });
let iframe;
const report = {
  host: null,
  templates: [],
  trial: false,
  production: false,
  recovery: false,
  models: [],
};
async function evaluate(expression, target = rpc) {
  const reply = await target.send('Runtime.evaluate', {
    expression: `window.__authoringVerifyPending=Promise.resolve().then(()=>(${expression}))`,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.ok(!reply.result?.exceptionDetails, JSON.stringify(reply.result?.exceptionDetails));
  return reply.result?.result?.value;
}
const api = (method, ...args) =>
  evaluate(`window.electronAPI.extensionPlugins.${method}(...${JSON.stringify(args)})`);
const inspect = (id) => api('inspectAuthoringDraft', session, id);
async function commit(stage) {
  assert.ok(stage.ok, JSON.stringify(stage));
  const result = await api('commit', stage.preview.token);
  assert.ok(result.ok && result.enabled !== false, JSON.stringify(result));
  return stage.preview.id;
}
const invoke = async (id, method, args = {}) => {
  const result = await api('call', {
    pluginId: id,
    sessionId: session,
    method: 'renderer.call',
    payload: { method, args },
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
};
const readHistory = (id) =>
  evaluate(
    `(${sessionAction.toString()})(window,${JSON.stringify({ command: 'session-read', id })})`
  );
let session;
try {
  // Start with one fresh module graph; HMR can retain old authoring/view-store instances.
  await rpc.send('Page.reload');
  await waitUntil(
    () => evaluate(`!!window.electronAPI?.extensionPlugins&&!!window.__stores?.sessions`),
    { timeout: 20000 }
  );
  const p = await evaluate(
    `window.__stores.settings.getState().addProject(${JSON.stringify(project)})`
  );
  session = await evaluate(
    `window.__stores.sessions.getState().newConversation(${JSON.stringify(p.id)},{forceNew:true})`
  );
  assert.ok(session);
  const context = await api('authoringContext', session);
  assert.ok(context.ok, JSON.stringify(context));
  report.host = context.capabilities.hostVersion;
  const drafts = [];
  for (const template of ['workspace', 'sidebar', 'command', 'tool']) {
    const created = await api('createAuthoringDraft', session, {
      template,
      request:
        template === 'workspace' ? '制作一个本地记忆/笔记管理插件' : `${template} 最小功能验收`,
    });
    assert.ok(created.ok, JSON.stringify(created));
    const draft = created.draft;
    drafts.push(draft);
    const inspection = await inspect(draft.id);
    assert.ok(inspection.ok, JSON.stringify(inspection));
    assert.equal(inspection.checks.static.state, 'passed');
    assert.equal(inspection.checks.models.state, 'unverified');
    const tested = await api('testAuthoringDraft', session, draft.id, true);
    assert.ok(tested.ok && tested.passed, JSON.stringify(tested));
    report.templates.push({ template, id: draft.id, tests: true });
    console.log(`PASS ${template}: actual host capability preflight + generated behavior tests`);
  }
  const draft = drafts[0];
  console.log('PHASE trial install and native workspace');
  const trial = await commit(await api('stageAuthoringTrial', session, draft.id));
  assert.notEqual(trial, draft.id);
  const loaded = await api('loadAuthoringTrial', session, draft.id);
  assert.ok(loaded.ok, JSON.stringify(loaded));
  assert.equal((await invoke(trial, 'listNotes')).notes.length, 0);
  await invoke(trial, 'addNote', { text: 'trial-only record' });
  const summary = (await api('list')).plugins.find((item) => item.id === trial);
  assert.ok(summary);
  const railSelector = `[data-rail-view="plugin:${trial}:${summary.views[0].id}"]`;
  await waitUntil(() => evaluate(`!!document.querySelector(${JSON.stringify(railSelector)})`), {
    timeout: 15000,
  });
  await evaluate(`document.querySelector(${JSON.stringify(railSelector)}).click()`);
  await waitUntil(
    () => evaluate(`!!document.querySelector('[data-slot="plugin-workspace"] iframe')`),
    { timeout: 15000 }
  );
  const frameUrl = await evaluate(
    `document.querySelector('[data-slot="plugin-workspace"] iframe').src`
  );
  const target = await waitUntil(
    async () =>
      (await fetchJson(port, '/json/list')).find(
        (item) => item.type === 'iframe' && item.url === frameUrl
      ),
    { timeout: 10000 }
  );
  iframe = await connect(target.webSocketDebuggerUrl, { expectedPort: port });
  await waitUntil(() => evaluate(`document.body.innerText.includes('trial-only record')`, iframe), {
    timeout: 15000,
  });
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.dv-tab')].some(tab=>tab.textContent.includes('（试用）'))`
    ),
    false
  );
  const shot = await rpc.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '/private/tmp/plugin-authoring-trial.png',
    Buffer.from(shot.result.data, 'base64')
  );
  report.trial = true;
  console.log('PASS native trial workspace');
  iframe.close();
  iframe = null;
  await evaluate(`document.querySelector('[data-rail-view="code"]').click()`);
  await evaluate(
    `(async()=>{const m=await import('/lib/sidePanelDock.ts');m.addSidePanelPluginAuthoring(${JSON.stringify({ ...draft, sessionId: session, projectId: p.id, cwd: project, prompt: '只修改当前插件目录', filled: false, title: '插件制作' })});})()`
  );
  console.log('PHASE authoring pane layout');
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('[data-slot="plugin-authoring-pane"]')?.innerText.includes('独立的试用')||document.querySelector('[data-slot="plugin-authoring-pane"]')?.innerText.includes('试用')`
      ),
    { timeout: 15000 }
  );
  await evaluate(
    `[...document.querySelectorAll('[data-slot="plugin-authoring-pane"] button')].find(button=>/展开制作面板|Expand authoring panel/.test(button.innerText))?.click()`
  );
  await waitUntil(
    () =>
      evaluate(
        `document.querySelector('[data-slot="plugin-authoring-pane"]').getBoundingClientRect().width>400`
      ),
    { timeout: 10000 }
  );
  assert.equal(
    await evaluate(
      `(()=>{const el=document.querySelector('[data-slot="plugin-authoring-pane"]');return el.scrollWidth>el.clientWidth+1})()`
    ),
    false,
    'Authoring pane must not clip its controls horizontally'
  );
  const pane = await rpc.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '/private/tmp/plugin-authoring-pane.png',
    Buffer.from(pane.result.data, 'base64')
  );
  await api('openAuthoringDraft', session, draft.id);
  const before = await inspect(draft.id);
  assert.ok(before.ok);
  await api('authoringEvidence', session, draft.id, {
    layer: 'business',
    sourceHash: before.sourceHash,
    note: 'Verified UI reads an isolated trial-only record.',
  });
  const file = join(project, draft.directory, 'view.html');
  await writeFile(file, (await readFile(file, 'utf8')).replace('</title>', ' updated</title>'));
  const stale = await inspect(draft.id);
  assert.equal(stale.checks.tests.state, 'stale');
  assert.equal(stale.checks.business.state, 'stale');
  assert.equal(stale.trial.current, false);
  await commit(await api('stageAuthoringTrial', session, draft.id));
  assert.ok((await api('loadAuthoringTrial', session, draft.id)).ok);
  assert.equal((await invoke(trial, 'listNotes')).notes[0].text, 'trial-only record');
  await commit(await api('stageAuthoringDraft', session, draft.id));
  assert.equal(
    (await invoke(draft.id, 'listNotes')).notes.length,
    0,
    'trial data must not enter production'
  );
  await invoke(draft.id, 'addNote', { text: 'production record survives update and rollback' });
  const manifestFile = join(project, draft.directory, 'enso-plugin.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.version = '0.1.1';
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  await commit(await api('stageAuthoringDraft', session, draft.id));
  assert.equal((await invoke(draft.id, 'listNotes')).notes.length, 1);
  await commit(await api('rollbackAuthoringDraft', session, draft.id));
  assert.equal(
    (await invoke(draft.id, 'listNotes')).notes[0].text,
    'production record survives update and rollback'
  );
  const finished = await api('finishAuthoringTrial', session, draft.id, true);
  assert.ok(finished.ok);
  assert.equal((await invoke(draft.id, 'listNotes')).notes.length, 1);
  report.production = true;
  console.log(
    'PASS separate trial + UI + source invalidation + production upgrade + code rollback + preserved data'
  );
  if (process.env.ENSO_VERIFY_REAL_MODELS === '1') {
    const selection = await evaluate('window.__stores.settings.getState().defaultModel');
    for (const modelId of ['auto/deepseek-v4.1-flash', 'auto/gpt-6.1-sol']) {
      const id = await evaluate(
        `window.__stores.sessions.getState().newConversation(${JSON.stringify(p.id)},{forceNew:true})`
      );
      const created = await api('createAuthoringDraft', id, {
        template: 'tool',
        request: '制作一个无界面的模型只读文本工具，保持模板功能',
      });
      assert.ok(created.ok);
      const source = created.draft;
      const prompt = `这是已授权的隔离插件制作验收。只修改 ${source.directory}/ 内文件，不改宿主或其他目录，不安装、不启用、不发布、不读取用户配置。先读该目录 HOST-CAPABILITIES.md、enso-plugin.json、main.mjs 和 test/main.test.mjs。当前宿主 ${source.hostVersion}。保留插件ID ${source.id} 和无页面只读工具结构；把清单显示名改为 Authoring ${modelId.includes('deepseek') ? 'DeepSeek' : 'OpenAI'} Proof，补充一个坏输入行为测试，执行 node --test 验证。只用 read/apply_patch/bash 等本地工具，不派子代理/不调用网络或插件工具。最终报告执行结果，未做的不要声称完成。`;
      const sent = await evaluate(
        `(${sessionAction.toString()})(window,${JSON.stringify({ command: 'session-send', id, providerId: selection.providerId, modelId, text: prompt })})`
      );
      assert.ok(sent.accepted, JSON.stringify(sent));
      await waitUntil(
        async () => {
          const state = await evaluate(
            `(${sessionAction.toString()})(window,${JSON.stringify({ command: 'session-state', id, afterSeq: sent.afterSeq })})`
          );
          assert.ok(!state.waiting, `Manual action required: ${JSON.stringify(state)}`);
          if (state.complete) {
            assert.ok(state.success, JSON.stringify(state));
            return true;
          }
        },
        { timeout: 240000, interval: 500 }
      );
      const history = await readHistory(id);
      assert.ok(history.ok);
      const tested = await api('testAuthoringDraft', id, source.id, true);
      assert.ok(tested.ok && tested.passed, JSON.stringify(tested));
      const changed = JSON.parse(
        await readFile(join(project, source.directory, 'enso-plugin.json'), 'utf8')
      );
      assert.equal(changed.id, source.id);
      assert.match(changed.name, /Proof/);
      assert.ok(!changed.renderer && !changed.contributes.views?.length);
      report.models.push({ modelId, generated: true, behaviorTests: true, id: source.id });
      console.log(`PASS ${modelId}: source generation preserves identity/capabilities + tests`);
    }
  }
  await rpc.send('Page.reload');
  await waitUntil(
    () => evaluate(`!!window.electronAPI?.extensionPlugins&&!!window.__stores?.sessions`),
    { timeout: 20000 }
  );
  const recovered = await api('authoringContext', session);
  assert.ok(recovered.ok);
  assert.ok(recovered.drafts.some((item) => item.id === draft.id));
  assert.ok((await api('openAuthoringDraft', session, draft.id)).ok);
  report.recovery = true;
  await writeFile(
    '/private/tmp/plugin-authoring-verification.json',
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  iframe?.close();
  rpc.close();
}
