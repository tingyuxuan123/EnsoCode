// Opt-in integration test. Never points at the default profile or installs into the user's app.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../../../../.agents/skills/enso-cdp/scripts/cdp-core.mjs';
import { sessionAction } from '../../../../.agents/skills/enso-cdp/scripts/cdp-session.mjs';

const port = Number(process.env.ENSO_CDP_PORT);
assert.ok(port && port !== 9222, 'An isolated non-default CDP port is required');
const zip = resolve(process.argv[2] ?? '');
assert.ok(zip.endsWith('.zip'), 'Pass the statically validated plugin ZIP');
const projectPath = process.env.MEMORY_VERIFY_PROJECT;
assert.ok(
  projectPath?.startsWith('/private/tmp/'),
  'Use a dedicated /private/tmp/ verification project'
);
const real = process.env.ENSO_VERIFY_REAL_MODELS === '1';
const pluginId = 'codekiln.memory';
const page = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const rpc = await connect(page.webSocketDebuggerUrl, { expectedPort: port, timeout: 180000 });
const report = { pluginId, installed: false, ui: false, models: [] };
let lastMethodAt = 0;
let viewRpc;
async function evaluate(expression, target = rpc) {
  const response = await target.send('Runtime.evaluate', {
    expression: `window.__memoryVerificationPending=Promise.resolve().then(()=>(${expression}))`,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.ok(!response.result?.exceptionDetails, JSON.stringify(response.result?.exceptionDetails));
  return response.result?.result?.value;
}
const session = (input) =>
  evaluate(`(${sessionAction.toString()})(window,${JSON.stringify(input)})`);
const plugin = (id, method, args = {}) =>
  evaluate(
    `window.electronAPI.extensionPlugins.call(${JSON.stringify({ pluginId, method: 'renderer.call', payload: { method, args }, sessionId: id })})`
  );
async function call(id, method, args) {
  // Scripted checks share the UI quota with the actual view; pace, never replay rate-limited writes.
  const delay = 500 - (Date.now() - lastMethodAt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastMethodAt = Date.now();
  const result = await plugin(id, method, args);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
async function turn(id, providerId, modelId, text) {
  const sent = await session({ command: 'session-send', id, providerId, modelId, text });
  assert.ok(sent.accepted, JSON.stringify(sent));
  const done = await waitUntil(
    async () => {
      const state = await session({ command: 'session-state', id, afterSeq: sent.afterSeq });
      assert.ok(!state.waiting, `Manual action required: ${JSON.stringify(state)}`);
      if (state.complete) return state;
    },
    { timeout: 180000, interval: 350 }
  );
  assert.ok(done.success, JSON.stringify(done));
  return session({ command: 'session-read', id });
}
try {
  console.log('PHASE installation');
  if (process.env.MEMORY_VERIFY_SKIP_INSTALL === '1') {
    const installed = await evaluate('window.electronAPI.extensionPlugins.list()');
    assert.ok(
      installed.plugins.some((entry) => entry.id === pluginId && entry.state === 'enabled')
    );
  } else {
    // Real File + native stage/preview/commit; no direct registry writes or hidden auto-grants.
    await evaluate(
      `(()=>{const input=document.createElement('input');input.type='file';input.id='memory-verification-zip';document.body.append(input)})()`
    );
    const doc = await rpc.send('DOM.getDocument');
    const node = await rpc.send('DOM.querySelector', {
      nodeId: doc.result.root.nodeId,
      selector: '#memory-verification-zip',
    });
    await rpc.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [zip] });
    const staged = await evaluate(
      `window.electronAPI.extensionPlugins.stageFile(document.getElementById('memory-verification-zip').files[0])`
    );
    assert.ok(staged.ok, JSON.stringify(staged));
    assert.equal(staged.preview.id, pluginId);
    report.permissions = staged.preview.permissions;
    const committed = await evaluate(
      `window.electronAPI.extensionPlugins.commit(${JSON.stringify(staged.preview.token)})`
    );
    assert.ok(committed.ok && committed.enabled !== false, JSON.stringify(committed));
  }
  report.installed = true;
  const memoryRail = '[data-rail-view="plugin:codekiln.memory:memory"]';
  await waitUntil(() => evaluate(`!!document.querySelector(${JSON.stringify(memoryRail)})`), {
    timeout: 15000,
  });
  // The global page does not manufacture a conversation merely to expose plugin-owned data.
  const initiallyEmpty = await evaluate('window.__stores.sessions.getState().activeId === null');
  if (initiallyEmpty) {
    await evaluate(`document.querySelector(${JSON.stringify(memoryRail)}).click()`);
    await waitUntil(() => evaluate(`!!document.querySelector('[data-slot="plugin-workspace"]')`), {
      timeout: 10000,
    });
    assert.equal((await call(null, 'status')).project, null);
    assert.equal(await evaluate('window.__stores.sessions.getState().activeId'), null);
    await evaluate(`document.querySelector('[data-rail-view="code"]').click()`);
  }
  console.log('PHASE project/session');
  const project = await evaluate(
    `window.__stores.settings.getState().addProject(${JSON.stringify(projectPath)})`
  );
  const id = await evaluate(
    `window.__stores.sessions.getState().newConversation(${JSON.stringify(project.id)},{forceNew:true})`
  );
  assert.ok(id);
  console.log(`PHASE UI (session ${id})`);
  await call(id, 'settings', { autoLearn: false, summarizeOnEnd: false });
  const saved = await call(id, 'save', {
    content: '宿主记忆联调：项目隔离与持久化通过',
    kind: 'project',
  });
  assert.ok(saved.memory.id);
  await evaluate(`document.querySelector(${JSON.stringify(memoryRail)}).click()`);
  await waitUntil(() => evaluate(`!!document.querySelector('[data-slot="plugin-workspace"]')`), {
    timeout: 10000,
  });
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(memoryRail)}).getAttribute('aria-pressed')`
    ),
    'true'
  );
  assert.equal(await evaluate(`!!document.querySelector('[data-slot="project-sidebar"]')`), false);
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.dv-tab')].some(tab=>tab.textContent.trim()==='记忆')`
    ),
    false
  );
  const opened = await evaluate(
    `window.electronAPI.extensionPlugins.call(${JSON.stringify({ pluginId, method: 'command.run', payload: { id: 'open' }, sessionId: id })})`
  );
  assert.ok(opened.ok, JSON.stringify(opened));
  const frameUrl = await evaluate(
    `document.querySelector('[data-slot="plugin-workspace"] iframe').src`
  );
  let memoryFrame;
  await waitUntil(
    async () => {
      memoryFrame = (await fetchJson(port, '/json/list')).find(
        (frame) => frame.type === 'iframe' && frame.url === frameUrl
      );
      return memoryFrame;
    },
    { timeout: 15000 }
  );
  viewRpc = await connect(memoryFrame.webSocketDebuggerUrl, { expectedPort: port });
  const context = viewRpc;
  await waitUntil(() => evaluate(`document.body.innerText.includes('宿主记忆联调')`, context), {
    timeout: 15000,
  });
  for (const tab of ['settings', 'memory']) {
    await evaluate(`document.querySelector('[data-tab="${tab}"]').click()`, context);
    await waitUntil(
      () =>
        evaluate(
          `document.querySelector('[data-tab="${tab}"]').getAttribute('aria-selected')==='true'`,
          context
        ),
      { timeout: 10000 }
    );
  }
  console.log('PHASE native themes');
  const measureHost = () =>
    evaluate(`(()=>{
    const sample=document.createElement('div');sample.style.cssText='position:fixed;visibility:hidden;background:var(--panel);color:var(--foreground);font-family:var(--font-family-sans);border-radius:var(--radius)';document.body.append(sample);
    const style=getComputedStyle(sample), primary=document.createElement('div');primary.style.background='var(--primary)';document.body.append(primary);
    const value={background:style.backgroundColor,foreground:style.color,primary:getComputedStyle(primary).backgroundColor,fontFamily:style.fontFamily,fontSize:getComputedStyle(document.body).fontSize,radius:style.borderRadius,theme:document.documentElement.classList.contains('dark')?'dark':'light'};
    sample.remove();primary.remove();return value;
  })()`);
  const measureView = () =>
    evaluate(
      `(()=>{const style=getComputedStyle(document.body),button=getComputedStyle(document.getElementById('add'));return {background:style.backgroundColor,foreground:style.color,primary:button.backgroundColor,fontFamily:style.fontFamily,fontSize:style.fontSize,radius:button.borderRadius,theme:document.documentElement.dataset.theme}})()`,
      context
    );
  report.themes = [];
  await evaluate(
    `(()=>{document.getElementById('add').click();document.getElementById('edit-content').value='主题切换时保留的编辑草稿'})()`,
    context
  );
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__stores.settings.getState().setTheme(${JSON.stringify(theme)})`);
    const expected = await measureHost();
    await waitUntil(async () => JSON.stringify(await measureView()) === JSON.stringify(expected), {
      timeout: 10000,
      interval: 150,
    });
    assert.equal(
      await evaluate(`document.getElementById('edit-content').value`, context),
      '主题切换时保留的编辑草稿'
    );
    report.themes.push({ name: theme, ...expected });
  }
  // Same-mode palette and typography changes exercise the style-tag observer, not only dark class.
  await evaluate(
    `(()=>{const style=document.createElement('style');style.id='memory-test-theme';style.textContent=':root:root { --panel:rgb(30, 42, 53);--foreground:rgb(235, 240, 245);--primary:rgb(238, 133, 44);--primary-foreground:rgb(10, 10, 10);--font-size-base:16px;--radius:8px; }';document.head.append(style)})()`
  );
  const custom = await measureHost();
  await waitUntil(async () => JSON.stringify(await measureView()) === JSON.stringify(custom), {
    timeout: 10000,
    interval: 150,
  });
  assert.equal(
    await evaluate(`document.getElementById('edit-content').value`, context),
    '主题切换时保留的编辑草稿'
  );
  assert.equal(
    await evaluate(`document.querySelector('[data-slot="plugin-workspace"] iframe').src`),
    frameUrl
  );
  report.themes.push({ name: 'same-mode-custom', ...custom });
  await evaluate(`document.getElementById('cancel-edit').click()`, context);
  const customShot = await rpc.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '/private/tmp/codekiln-memory-custom-theme.png',
    Buffer.from(customShot.result.data, 'base64')
  );
  await evaluate(`document.getElementById('memory-test-theme').remove()`);
  const normal = await measureHost();
  await waitUntil(async () => JSON.stringify(await measureView()) === JSON.stringify(normal), {
    timeout: 10000,
    interval: 150,
  });
  report.navigation = {
    activitybar: true,
    workspace: true,
    noRightTab: true,
    globalWithoutSession: initiallyEmpty,
  };
  report.ui = true;
  const screenshot = await rpc.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '/private/tmp/codekiln-memory-host.png',
    Buffer.from(screenshot.result.data, 'base64')
  );
  viewRpc.close();
  viewRpc = undefined;
  await evaluate(`document.querySelector('[data-rail-view="code"]').click()`);
  assert.equal(await evaluate(`!!document.querySelector('[data-slot="plugin-workspace"]')`), false);
  await evaluate(`document.querySelector(${JSON.stringify(memoryRail)}).click()`);
  const disabled = await evaluate(
    `window.electronAPI.extensionPlugins.setEnabled(${JSON.stringify(pluginId)},false)`
  );
  assert.ok(disabled.ok, JSON.stringify(disabled));
  await waitUntil(
    () =>
      evaluate(
        `!document.querySelector(${JSON.stringify(memoryRail)})&&!document.querySelector('[data-slot="plugin-workspace"]')`
      ),
    { timeout: 10000 }
  );
  const enabled = await evaluate(
    `window.electronAPI.extensionPlugins.setEnabled(${JSON.stringify(pluginId)},true)`
  );
  assert.ok(enabled.ok, JSON.stringify(enabled));
  await waitUntil(() => evaluate(`!!document.querySelector(${JSON.stringify(memoryRail)})`), {
    timeout: 10000,
  });
  assert.equal((await call(id, 'read', { id: saved.memory.id })).items[0].id, saved.memory.id);
  report.navigation.disableCleanup = true;
  report.navigation.dataPreserved = true;
  if (real) {
    console.log('PHASE real models');
    const selection = await evaluate(`window.__stores.settings.getState().defaultModel`);
    for (const modelId of ['auto/deepseek-v4.1-flash', 'auto/gpt-6.1-sol']) {
      const sessionId = await evaluate(
        `window.__stores.sessions.getState().newConversation(${JSON.stringify(project.id)},{forceNew:true})`
      );
      const marker = `MEMORY_PROOF_${modelId.includes('deepseek') ? 'DEEPSEEK' : 'OPENAI'}_${Date.now()}`;
      const history = await turn(
        sessionId,
        selection.providerId,
        modelId,
        `这是已授权的隔离插件验收，请只使用 plugin_codekiln-memory__ 前缀的工具，不要读文件/运行命令/调用其他工具。依次完成：1 memory_status；2 memory_write 保存项目 fact，content精确为 ${marker}；3 memory_read 用返回id读单条；4 memory_search 查询 ${marker}；5 memory_forget 删除该id；6 memory_restore 用返回recoveryId恢复；7 scratchpad action=add,text=${marker} 待办，然后列出待办。只传必要参数，未用的可选参数省略。每一步必须真的调用工具且检查结果，最后只回复 ${marker} DONE。`
      );
      assert.ok(history.ok, JSON.stringify(history));
      const json = JSON.stringify(history);
      for (const message of history.history?.messages ?? []) {
        if (
          message.role !== 'toolResult' ||
          !message.toolName?.startsWith('plugin_codekiln-memory__')
        )
          continue;
        assert.notEqual(message.isError, true, JSON.stringify(message));
        const result = JSON.parse(
          message.content.find((part) => part.type === 'text').text.split('\n')[0]
        );
        assert.notEqual(
          result.ok,
          false,
          JSON.stringify({ modelId, tool: message.toolName, result })
        );
      }
      for (const name of [
        'memory_status',
        'memory_write',
        'memory_read',
        'memory_search',
        'memory_forget',
        'memory_restore',
        'scratchpad',
      ])
        assert.ok(
          json.includes(`plugin_codekiln-memory__${name}`),
          `${modelId} didn't call ${name}`
        );
      const results = await call(sessionId, 'search', { query: marker });
      assert.ok(results.count >= 2, `${modelId}: durable memory and task missing`);
      report.models.push({ modelId, sevenTools: true, persisted: true, sessionId });
      await writeFile(
        '/private/tmp/codekiln-memory-host-report.json',
        JSON.stringify(report, null, 2)
      );
      console.log(`PASS ${modelId}: seven real model tools + durable memory/task`);
    }
    const current = report.models.at(-1);
    const configured = await evaluate(
      `window.electronAPI.extensionPlugins.configSet(${JSON.stringify(pluginId)},{model:${JSON.stringify(`${selection.providerId}::auto/deepseek-v4.1-flash`)}})`
    );
    assert.ok(configured.ok, JSON.stringify(configured));
    await call(current.sessionId, 'settings', { autoLearn: true, summarizeOnEnd: true });
    await turn(
      current.sessionId,
      selection.providerId,
      current.modelId,
      '补充一条长期有效的当前项目约定：本项目统一使用 pnpm，所有可单测逻辑必须先补失败测试再实现。请只回复“收到”，这轮不要调用任何工具。'
    );
    await waitUntil(
      async () => {
        const memory = await call(current.sessionId, 'read', {});
        const daily = await call(current.sessionId, 'read', { target: 'daily' });
        return (
          memory.items.some((row) => row.source === 'auto' && row.content.includes('pnpm')) &&
          daily.items.some((row) => row.kind === 'summary')
        );
      },
      { timeout: 30000, interval: 1500 }
    );
    report.automation = {
      learned: true,
      summaryCheckpoint: true,
      model: 'auto/deepseek-v4.1-flash',
    };
    await call(current.sessionId, 'settings', { autoLearn: false, summarizeOnEnd: false });
    console.log('PASS real automatic learning + session summary checkpoint');
  }
  await writeFile('/private/tmp/codekiln-memory-host-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  viewRpc?.close();
  rpc.close();
}
