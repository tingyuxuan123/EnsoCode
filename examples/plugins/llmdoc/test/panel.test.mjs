import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';

const html = await readFile(new URL('../knowledge.html', import.meta.url), 'utf8');
const maliciousText = '<img src=x onerror="alert(1)" />';
const docPath = 'llmdoc/tools/example.mdx';
const emptyPage = { entries: [], total: 0, nextCursor: null };
const contextDoc = { path: docPath, kind: 'guide', description: maliciousText };

function response(operation, result, exitCode = 0) {
  return { operation, result, exitCode };
}

async function open(t, methods = {}) {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
  t.after(() => window.happyDOM.close());
  const calls = [];
  const methodsWithDefaults = {
    inspect: () => ({ state: 'present', configured: true, gitConfigured: true }),
    tree: () => emptyPage,
    status: () => response('status', { documents: { total: 0 } }),
    ...methods,
  };
  window.enso = {
    call: async (method, args) => {
      calls.push([method, JSON.parse(JSON.stringify(args ?? {}))]);
      return methodsWithDefaults[method]?.(args);
    },
  };
  const { document } = window;
  document.write(html);
  const script = document.querySelector('script');
  runInNewContext(script.textContent, { window, document });
  await flush();
  const byId = (id) => document.getElementById(id);
  const click = async (id) => {
    byId(id).click();
    await flush();
  };
  const hostClick = async (id) => {
    // Happy DOM has no physical input. Emulate the browser's trusted event at this test boundary.
    const event = new window.MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'isTrusted', { value: true });
    byId(id).dispatchEvent(event);
    await flush();
  };
  return { document, byId, click, hostClick, calls };
}

const installableSetup = {
  nodeAvailable: true,
  cliAvailable: false,
  gitAvailable: true,
  canInstall: true,
};

test('installation needs a trusted click, retries a failure, and re-inspects after success', async (t) => {
  let configured = false;
  let rejectDownload;
  const { byId, calls, click, hostClick } = await open(t, {
    inspect: () => ({
      state: 'present',
      configured,
      gitConfigured: true,
      setup: { ...installableSetup, cliAvailable: configured },
    }),
    install_cli: () => {
      if (!rejectDownload) {
        return new Promise((_, reject) => {
          rejectDownload = reject;
        });
      }
      configured = true;
      return { installed: true };
    },
  });
  assert.deepEqual(calls, [['inspect', {}]]);
  const button = byId('install-cli');
  assert.ok(button, 'first-run installation control');
  assert.equal(button.closest('[hidden]'), null);
  assert.match(
    byId(button.getAttribute('aria-describedby')).textContent,
    /npm 官方.*固定版本.*扩展私有目录.*不.*写入.*项目/
  );
  await click('install-cli');
  await click('inspect');
  assert.deepEqual(calls, [
    ['inspect', {}],
    ['inspect', {}],
  ]);

  await hostClick('install-cli');
  assert.deepEqual(calls.at(-1), ['install_cli', {}]);
  assert.match(byId('status').textContent, /正在.*安装/);
  assert.equal(button.disabled, true);
  assert.equal(byId('inspect').disabled, true);
  await hostClick('install-cli');
  assert.equal(calls.filter(([method]) => method === 'install_cli').length, 1);

  rejectDownload(new Error(`安装失败：${maliciousText}`));
  await flush();
  assert.equal(byId('error').hidden, false);
  assert.ok(byId('error').textContent.includes(maliciousText));
  assert.equal(byId('error').querySelector('img'), null);
  assert.equal(button.disabled, false);

  await hostClick('install-cli');
  assert.deepEqual(calls.slice(-4), [
    ['install_cli', {}],
    ['inspect', {}],
    ['tree', {}],
    ['status', {}],
  ]);
  assert.notEqual(button.closest('[hidden]'), null);
  assert.equal(byId('catalog').hidden, false);
  assert.match(byId('install-result').textContent, /已安装/);
});

test('already-installed response rechecks the missing library without opening its tree', async (t) => {
  let configured = false;
  const { byId, calls, hostClick } = await open(t, {
    inspect: () => ({
      state: 'missing',
      configured,
      gitConfigured: true,
      setup: { ...installableSetup, cliAvailable: configured },
    }),
    install_cli: () => {
      configured = true;
      return { installed: false, alreadyPresent: true };
    },
  });
  assert.ok(byId('install-cli'), 'first-run installation control');
  await hostClick('install-cli');
  assert.deepEqual(calls, [
    ['inspect', {}],
    ['install_cli', {}],
    ['inspect', {}],
  ]);
  assert.match(byId('install-result').textContent, /已存在|已安装/);
  assert.equal(byId('catalog').hidden, true);
  assert.equal(byId('init').disabled, false);
});

test('missing Node and Git report manual paths and do not offer unavailable installation', async (t) => {
  const { byId, calls } = await open(t, {
    inspect: () => ({
      state: 'present',
      configured: false,
      gitConfigured: false,
      setup: {
        nodeAvailable: false,
        cliAvailable: false,
        gitAvailable: false,
        canInstall: false,
        installUnavailableReason: '此系统暂不支持一键安装',
      },
    }),
  });
  assert.deepEqual(calls, [['inspect', {}]]);
  assert.ok(byId('install-cli'), 'first-run installation control');
  assert.notEqual(byId('install-cli').closest('[hidden]'), null);
  assert.match(byId('setup').textContent, /Node\.js.*扩展设置.*绝对路径/);
  assert.match(byId('git-configuration').textContent, /Git.*扩展设置.*绝对路径/);
  assert.match(byId('setup').textContent, /此系统暂不支持一键安装/);
});

test('missing library offers only initialization and stages a draft without other calls', async (t) => {
  const panel = await open(t, {
    inspect: () => ({ state: 'missing', configured: true, gitConfigured: true }),
    prepare_workflow: () => ({ prepared: true }),
  });
  assert.deepEqual(panel.calls, [['inspect', {}]]);
  assert.equal(panel.byId('catalog').hidden, true);
  assert.equal(panel.byId('init').hidden, false);
  assert.equal(panel.byId('init').disabled, false);
  assert.equal(panel.byId('maintenance').hidden, true);
  await panel.click('init');
  assert.deepEqual(panel.calls, [
    ['inspect', {}],
    ['prepare_workflow', { action: 'init' }],
  ]);
  assert.match(panel.byId('workflow-result').textContent, /草稿.*回到对话.*手动发送/);
  assert.match(panel.byId('workflow').textContent, /不会修改项目或自动发送.*Git 提交会分别/);
});

test('unsupported context and an unconfigured CLI both fail visibly without browsing', async (t) => {
  const unsupported = await open(t, {
    inspect: () => {
      throw new Error('请在本机 Code Git 项目会话中打开');
    },
  });
  assert.deepEqual(unsupported.calls, [['inspect', {}]]);
  assert.equal(unsupported.byId('error').hidden, false);
  assert.match(unsupported.byId('error').textContent, /本机 Code Git 项目会话/);
  assert.equal(unsupported.byId('workflow').hidden, true);
  assert.notEqual(unsupported.byId('install-cli').closest('[hidden]'), null);

  const unconfigured = await open(t, {
    inspect: () => ({
      state: 'present',
      configured: false,
      gitConfigured: true,
      configurationError: '找不到 llmdoc CLI',
    }),
  });
  assert.deepEqual(unconfigured.calls, [['inspect', {}]]);
  assert.equal(unconfigured.byId('error').hidden, false);
  assert.match(unconfigured.byId('error').textContent, /找不到 llmdoc CLI/);
  assert.equal(unconfigured.byId('catalog').hidden, true);
});

test('without a configured Git executable, browsing works and Git-dependent operations stay blocked', async (t) => {
  let gitConfigured = false;
  const { byId, click, calls } = await open(t, {
    inspect: () => ({
      state: 'present',
      configured: true,
      gitConfigured,
      gitConfigurationError: '找不到已配置的 Git',
    }),
    search: () => emptyPage,
    context: () =>
      response('context', {
        impacted: [],
        prerequisites: [],
        unmappedFiles: [],
        pagination: { totalItems: 0, nextCursor: null },
      }),
    prune_report: () => response('prune_report', {}),
  });
  assert.deepEqual(calls, [
    ['inspect', {}],
    ['tree', {}],
  ]);
  assert.equal(byId('git-configuration').hidden, false);
  assert.match(byId('git-configuration').textContent, /找不到已配置的 Git.*扩展设置/);
  assert.equal(byId('catalog').hidden, false);
  for (const id of ['status-report', 'delta', 'validate', 'update', 'prune']) {
    assert.equal(byId(id).disabled, true);
    await click(id);
  }
  assert.equal(calls.length, 2);
  byId('query').value = 'docs';
  byId('files').value = 'src/example.ts';
  await click('search');
  await click('context');
  await click('prune-report');
  assert.deepEqual(calls.slice(2), [
    ['search', { query: 'docs' }],
    ['context', { files: ['src/example.ts'] }],
    ['prune_report', {}],
  ]);
  assert.equal(byId('git-configuration').hidden, false);

  gitConfigured = true;
  await click('inspect');
  assert.equal(byId('git-configuration').hidden, true);
  assert.equal(byId('update').disabled, false);
  assert.deepEqual(calls.slice(-3), [
    ['inspect', {}],
    ['tree', {}],
    ['status', {}],
  ]);
});

test('context sends project-relative source paths and retains them when paging', async (t) => {
  const { document, byId, click, calls } = await open(t, {
    context: ({ cursor }) =>
      response('context', {
        impacted: cursor ? [] : [contextDoc],
        prerequisites: cursor ? [{ ...contextDoc, path: 'llmdoc/index.mdx' }] : [],
        unmappedFiles: ['src/no match.ts'],
        pagination: { totalItems: 2, nextCursor: cursor ? null : 'cursor2' },
      }),
    show: () => ({ id: docPath, body: maliciousText }),
  });
  byId('files').value = ' src/a.ts\n\nsrc/my file.ts ';
  await click('context');
  assert.deepEqual(calls.at(-1), ['context', { files: ['src/a.ts', 'src/my file.ts'] }]);
  assert.match(byId('results').textContent, /受影响文档/);
  assert.ok(byId('results').textContent.includes(maliciousText));
  assert.match(byId('results').textContent, /src\/no match\.ts/);
  assert.equal(byId('results').querySelector('img'), null);
  byId('results').querySelector('button').click();
  await flush();
  assert.deepEqual(calls.at(-1), ['show', { id: docPath }]);
  assert.equal(byId('body').textContent, maliciousText);
  assert.equal(document.querySelector('img'), null);

  byId('files').value = 'different.ts';
  await click('next');
  assert.deepEqual(calls.at(-1), [
    'context',
    { files: ['src/a.ts', 'src/my file.ts'], cursor: 'cursor2' },
  ]);
  assert.match(byId('results').textContent, /前置文档/);
  assert.equal(byId('next').hidden, true);

  for (const path of ['/outside.ts', '../outside.ts', 'C:\\outside.ts']) {
    const count = calls.length;
    byId('files').value = path;
    await click('context');
    assert.equal(calls.length, count);
    assert.equal(byId('error').hidden, false);
    assert.match(byId('error').textContent, /项目相对/);
  }
});

test('present library shows status, paginates review, and shows failed validation as text', async (t) => {
  const { byId, click, calls } = await open(t, {
    status: () =>
      response('status', {
        documents: { total: 5, impacted: 2, needsReview: 1, dirty: 1 },
        head: 'abc42',
        commitsBehindHead: 2,
        degradedReason: maliciousText,
      }),
    delta: ({ cursor }) =>
      response('delta', {
        needsReview: [cursor ? 'llmdoc/other.mdx' : docPath],
        impacted: [],
        pagination: { totalItems: 2, nextCursor: cursor ? null : 'review2' },
      }),
    validate: () => response('validate', { errors: [maliciousText] }, 1),
    prune_report: () => response('prune_report', { candidates: [maliciousText] }),
  });
  assert.deepEqual(calls.slice(0, 3), [
    ['inspect', {}],
    ['tree', {}],
    ['status', {}],
  ]);
  assert.equal(byId('init').hidden, true);
  assert.equal(byId('maintenance').hidden, false);
  assert.match(byId('overview').textContent, /文档总数[：:]\s*5/);
  assert.match(byId('overview').textContent, /待复核[：:]\s*1/);
  assert.ok(byId('overview').textContent.includes(maliciousText));
  assert.equal(byId('overview').querySelector('img'), null);

  await click('delta');
  assert.match(byId('review').textContent, /待复核/);
  assert.ok(byId('review').textContent.includes(docPath));
  await click('delta-next');
  assert.deepEqual(calls.at(-1), ['delta', { cursor: 'review2' }]);
  assert.ok(byId('review').textContent.includes('llmdoc/other.mdx'));
  assert.equal(byId('delta-next').hidden, true);

  await click('validate');
  assert.equal(byId('diagnostics').hidden, false);
  assert.match(byId('report-title').textContent, /校验未通过/);
  assert.deepEqual(JSON.parse(byId('report-text').textContent).errors, [maliciousText]);
  assert.equal(byId('diagnostics').querySelector('img'), null);
  await click('prune-report');
  assert.deepEqual(calls.at(-1), ['prune_report', {}]);
  assert.match(byId('report-title').textContent, /收敛报告/);
});

test('maintenance prepares only update/prune drafts and surfaces refusal to overwrite one', async (t) => {
  const { byId, click, calls } = await open(t, {
    prepare_workflow: ({ action }) => {
      if (action === 'update') throw new Error('聊天草稿不为空，不会覆盖');
      return { prepared: true };
    },
  });
  await click('update');
  assert.equal(byId('error').hidden, false);
  assert.match(byId('error').textContent, /草稿不为空/);
  assert.equal(byId('workflow-result').textContent, '');
  await click('prune');
  assert.deepEqual(calls.slice(3), [
    ['prepare_workflow', { action: 'update' }],
    ['prepare_workflow', { action: 'prune' }],
  ]);
  assert.match(byId('workflow-result').textContent, /草稿.*不是已执行|草稿.*尚未执行/);
});

test('empty searches show coverage guidance, and sampled reports are never displayed as complete', async (t) => {
  const truncatedFields = [{ path: 'unmapped.dirty', totalItems: 4000, returnedItems: 30 }];
  const { byId, click } = await open(t, {
    search: () => ({
      ...emptyPage,
      indexedDocuments: 2,
      hint: '仅检索知识地图中的 2 篇文档，不代表源码中没有此功能。',
    }),
    status: () => ({ ...response('status', { documents: { total: 2 } }), truncatedFields }),
    delta: () => ({
      ...response('delta', { impacted: [], needsReview: [], unmapped: { dirty: ['src/a.ts'] } }),
      truncatedFields,
    }),
    validate: () => ({
      ...response('validate', { ok: false, errors: ['error'] }, 1),
      truncatedFields: [{ path: 'errors', totalItems: 3000, returnedItems: 30 }],
    }),
  });
  assert.match(byId('overview').textContent, /部分明细/);
  assert.match(byId('overview').textContent, /4000/);
  byId('query').value = '插件 主题 样式变量';
  await click('search');
  assert.match(byId('status').textContent, /2 篇文档/);
  assert.match(byId('status').textContent, /源码/);
  await click('delta');
  assert.match(byId('review').textContent, /部分明细/);
  assert.match(byId('review').textContent, /4000/);
  await click('validate');
  assert.match(byId('status').textContent, /部分明细/);
  assert.match(byId('status').textContent, /3000/);
});
