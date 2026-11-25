import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createAutomation,
  parseProposal,
  renderDocument,
  renderLedger,
} from '../automation.mjs';

const meta = {
  schema: 'llmdoc.meta/v3',
  baseline: { revision: 'a'.repeat(40), verifiedAt: '2026-11-23T09:24:55Z' },
  documents: {
    'sessions/message-projection.mdx': { validatedRevision: null },
  },
  convergence: {
    capturedAt: '2026-11-23T09:24:55Z',
    source: 'init',
    documentCount: 1,
    totalEstimatedTokens: 120,
  },
};
const existing = [
  { path: 'llmdoc/sessions/message-projection.mdx', text: '# 已有\n\n会话投影边界。\n' },
];

function proposal(overrides = {}) {
  return JSON.stringify({
    documents: [
      {
        path: 'llmdoc/renderer/plugin-theme.mdx',
        kind: 'architecture',
        description: '插件页面如何跟随应用主题，以及令牌从主界面注入到沙箱的边界。',
        codePaths: ['src/renderer/plugins/themeBridge.ts'],
        body: '# 插件主题\n\n- **令牌由宿主注入。**\n\n源码：`src/renderer/plugins/themeBridge.ts`。\n',
      },
    ],
    ...overrides,
  });
}

test('rejects proposals with unsafe paths, kinds or unbounded bodies', () => {
  for (const bad of [
    proposal({ documents: [{ path: '../escape.mdx', kind: 'guide', description: 'x', codePaths: [], body: 'x' }] }),
    proposal({ documents: [{ path: 'llmdoc/index.mdx', kind: 'guide', description: 'x', codePaths: [], body: 'x' }] }),
    proposal({ documents: [{ path: 'llmdoc/a/b/c.mdx', kind: 'guide', description: 'x', codePaths: [], body: 'x' }] }),
    proposal({ documents: [{ path: 'llmdoc/a.mdx', kind: 'note', description: 'x', codePaths: [], body: 'x' }] }),
    proposal({ documents: [{ path: 'llmdoc/a.mdx', kind: 'guide', description: '', codePaths: [], body: 'x' }] }),
    proposal({ documents: [{ path: 'llmdoc/a.mdx', kind: 'guide', description: 'x', codePaths: ['../a.ts'], body: 'x' }] }),
    proposal({ documents: [{ path: 'llmdoc/a.mdx', kind: 'guide', description: 'x', codePaths: [], body: 'x'.repeat(40001) }] }),
  ]) {
    assert.throws(() => parseProposal(bad));
  }
  assert.equal(parseProposal('NONE').documents.length, 0);
  assert.equal(parseProposal('```json\n' + proposal() + '\n```').documents[0].path, 'llmdoc/renderer/plugin-theme.mdx');
});

test('a proposed document keeps a stable identity and escapes front matter values', () => {
  const [doc] = parseProposal(proposal()).documents;
  const text = renderDocument(doc);
  assert.match(text, /^---\n/);
  assert.match(text, /kind: architecture/);
  assert.match(text, /description: "插件页面如何跟随应用主题，以及令牌从主界面注入到沙箱的边界。"/);
  assert.match(text, /code:\n {2}paths:\n {4}- src\/renderer\/plugins\/themeBridge\.ts\n/);
  assert.equal(renderDocument(doc), text);
  assert.throws(() => parseProposal(proposal({ documents: [{ ...doc, description: 'a"\nb' }] })));
});

test('the ledger registers new documents and keeps the existing baseline', () => {
  const [doc] = parseProposal(proposal()).documents;
  const next = renderLedger(meta, [doc]);
  assert.equal(next.baseline.revision, meta.baseline.revision);
  assert.equal(next.documents['renderer/plugin-theme.mdx'].validatedRevision, null);
  assert.deepEqual(Object.keys(next.documents).sort(), [
    'renderer/plugin-theme.mdx',
    'sessions/message-projection.mdx',
  ]);
  assert.equal(next.convergence.source, 'init');
  assert.ok(next.convergence.documentCount >= 1);
});

async function workspace(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codekiln-llmdoc-auto-')));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, 'llmdoc', 'sessions'), { recursive: true });
  await writeFile(join(root, 'llmdoc', 'meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(join(root, 'llmdoc', 'sessions', 'message-projection.mdx'), existing[0].text);
  await mkdir(join(root, 'src', 'renderer', 'plugins'), { recursive: true });
  await writeFile(join(root, 'src', 'renderer', 'plugins', 'themeBridge.ts'), 'export const a = 1;\n');
  const dataDir = join(root, '.plugin-data');
  await mkdir(dataDir);
  return { root, dataDir };
}

function mount(proposalText, options = {}) {
  const calls = [];
  const events = new Map();
  const notifications = [];
  const api = {
    dataDir: '',
    config: { get: async () => options.config ?? { autoMaintain: true } },
    fs: {
      readText: async (path) => readFile(join(api.root, path), 'utf8'),
      writeText: async (path, text) => {
        const absolute = join(api.root, path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, text);
        return null;
      },
    },
    agent: {
      run: async (input) => {
        calls.push(input);
        if (options.fail) throw new Error('AGENT_FAILED');
        return { text: typeof proposalText === 'function' ? proposalText(input) : proposalText };
      },
    },
    session: { inject: async () => null },
    ui: { notify: async (...args) => notifications.push(args), view: { emit: async () => null } },
    events: { on: (name, handler) => events.set(name, handler) },
  };
  return { api, calls, events, notifications };
}

test('one agent_end run proposes documents, writes them atomically and records a review entry', async (t) => {
  const { root, dataDir } = await workspace(t);
  const { api, calls, events } = mount(proposal());
  api.dataDir = dataDir;
  api.root = root;
  const automation = createAutomation(api, { projectRoot: (ctx) => ctx.projectRoot });
  events.set('agent_end', (data, ctx) => automation.end(data, ctx));
  await events.get('agent_end')({ text: '完成插件主题注入。' }, {
    sessionId: 's1',
    projectRoot: root,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context, 'none');
  assert.match(calls[0].prompt, /themeBridge|会话投影/);
  assert.match(await readFile(join(root, 'llmdoc/renderer/plugin-theme.mdx'), 'utf8'), /插件主题/);
  const ledger = JSON.parse(await readFile(join(root, 'llmdoc/meta.json'), 'utf8'));
  assert.equal(ledger.documents['renderer/plugin-theme.mdx'].validatedRevision, null);
  assert.equal(ledger.baseline.revision, meta.baseline.revision);
  const review = JSON.parse(await readFile(join(dataDir, 'reviews.json'), 'utf8'));
  assert.equal(review.entries.length, 1);
  assert.equal(review.entries[0].status, 'applied');
  assert.deepEqual(review.entries[0].files.map((file) => file.path), [
    'llmdoc/renderer/plugin-theme.mdx',
    'llmdoc/meta.json',
  ]);
});

test('a second run merges an existing document instead of overwriting it', async (t) => {
  const { root, dataDir } = await workspace(t);
  const first = mount(proposal());
  first.api.dataDir = dataDir;
  first.api.root = root;
  const a = createAutomation(first.api, { projectRoot: (ctx) => ctx.projectRoot });
  await a.end({ text: '第一次' }, { sessionId: 's1', projectRoot: root });
  const updated = proposal({
    documents: [
      {
        path: 'llmdoc/sessions/message-projection.mdx',
        kind: 'architecture',
        description: '会话正文权威与投影边界。',
        codePaths: ['src/renderer/stores/sessions/reducer.ts'],
        body: '# 会话正文与历史恢复\n\n- **新增：快照补回。**\n',
      },
    ],
  });
  const second = mount(updated);
  second.api.dataDir = dataDir;
  second.api.root = root;
  const b = createAutomation(second.api, { projectRoot: (ctx) => ctx.projectRoot });
  await b.end({ text: '第二次' }, { sessionId: 's2', projectRoot: root });
  const text = await readFile(join(root, 'llmdoc/sessions/message-projection.mdx'), 'utf8');
  assert.match(text, /快照补回/);
  assert.match(text, /会话投影边界/);
  assert.match(text, /reducer\.ts/);
  const review = JSON.parse(await readFile(join(dataDir, 'reviews.json'), 'utf8'));
  assert.equal(review.entries.length, 2);
  assert.equal(review.entries[1].files[0].before, existing[0].text);
});

test('a failed or malformed run writes nothing and keeps the turn alive', async (t) => {
  const { root, dataDir } = await workspace(t);
  const before = await readFile(join(root, 'llmdoc/meta.json'), 'utf8');
  for (const options of [{ fail: true }, { proposal: 'not json' }]) {
    const { api, notifications } = mount(options.proposal ?? proposal(), options);
    api.dataDir = dataDir;
    api.root = root;
    const automation = createAutomation(api, { projectRoot: (ctx) => ctx.projectRoot });
    await automation.end({ text: 'x' }, { sessionId: 's1', projectRoot: root });
    assert.ok(notifications.length >= 1);
  }
  assert.equal(await readFile(join(root, 'llmdoc/meta.json'), 'utf8'), before);
  await assert.rejects(readFile(join(root, 'llmdoc/renderer/plugin-theme.mdx'), 'utf8'), {
    code: 'ENOENT',
  });
});

test('coalesces to one run per project and skips when disabled or unsupported', async (t) => {
  const { root, dataDir } = await workspace(t);
  let release;
  const { api, calls } = mount(() => 'NONE');
  api.agent.run = async (input) => {
    calls.push(input);
    await new Promise((resolve) => {
      release = resolve;
    });
    return { text: 'NONE' };
  };
  api.dataDir = dataDir;
  api.root = root;
  const automation = createAutomation(api, { projectRoot: (ctx) => ctx.projectRoot });
  const first = automation.end({ text: 'a' }, { sessionId: 's1', projectRoot: root });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await automation.end({ text: 'b' }, { sessionId: 's2', projectRoot: root });
  assert.equal(second.skipped, true);
  release();
  await first;
  assert.equal(calls.length, 1);

  const off = mount(proposal(), { config: { autoMaintain: false } });
  off.api.dataDir = dataDir;
  off.api.root = root;
  const disabled = createAutomation(off.api, { projectRoot: (ctx) => ctx.projectRoot });
  assert.equal((await disabled.end({ text: 'c' }, { sessionId: 's3', projectRoot: root })).skipped, true);
  assert.equal(off.calls.length, 0);
  assert.equal((await automation.end({ text: 'd' }, { sessionId: 's1::child', projectRoot: root, agent: { kind: 'subagent' } })).skipped, true);
});

test('restore returns the exact prior bytes and refuses a stale review entry', async (t) => {
  const { root, dataDir } = await workspace(t);
  const { api } = mount(proposal());
  api.dataDir = dataDir;
  api.root = root;
  const automation = createAutomation(api, { projectRoot: (ctx) => ctx.projectRoot });
  await automation.end({ text: 'x' }, { sessionId: 's1', projectRoot: root });
  const review = JSON.parse(await readFile(join(dataDir, 'reviews.json'), 'utf8'));
  const id = review.entries[0].id;
  const created = join(root, 'llmdoc/renderer/plugin-theme.mdx');
  const after = await readFile(created, 'utf8');
  const restored = await automation.restore(id);
  assert.equal(restored.restored, true);
  await assert.rejects(readFile(created, 'utf8'), { code: 'ENOENT' });
  assert.match(await readFile(join(root, 'llmdoc/meta.json'), 'utf8'), /message-projection/);

  await writeFile(created, after);
  const review2 = JSON.parse(await readFile(join(dataDir, 'reviews.json'), 'utf8'));
  assert.equal(review2.entries[0].status, 'restored');
  await assert.rejects(automation.restore(id), /已经恢复|已被修改/);
});

test('a review entry records what the model proposed and what was written', async (t) => {
  const { root, dataDir } = await workspace(t);
  const { api } = mount(proposal());
  api.dataDir = dataDir;
  api.root = root;
  const automation = createAutomation(api, { projectRoot: (ctx) => ctx.projectRoot });
  await automation.end({ text: 'x' }, { sessionId: 's1', projectRoot: root });
  const review = JSON.parse(await readFile(join(dataDir, 'reviews.json'), 'utf8'));
  assert.equal(review.entries[0].model, undefined);
  assert.match(review.entries[0].summary, /plugin-theme/);
  assert.ok(review.entries[0].proposal.documents[0].body.length > 0);
  assert.equal(review.entries[0].files[0].path, 'llmdoc/renderer/plugin-theme.mdx');
});
