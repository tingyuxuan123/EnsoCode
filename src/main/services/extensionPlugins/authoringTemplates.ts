import {
  type AuthoringTemplate,
  authoringCapabilities,
} from '../../../shared/extensionPlugins/authoringContract';

interface TemplateInput {
  id: string;
  hostVersion: string;
  template: AuthoringTemplate;
  request?: string;
}

const ACTIVATION_TYPE = '/** @type {import("./enso-plugin").PluginActivate} */';

const NOTES_MAIN = String.raw`import { lstat, mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
}
function validStore(value) {
  return object(value) && value.version === 1 && object(value.projects) &&
    Object.entries(value.projects).every(([key, notes]) => /^[a-f0-9]{64}$/.test(key) &&
      Array.isArray(notes) && notes.length <= 1000 && Buffer.byteLength(JSON.stringify(notes)) <= 48 * 1024 &&
      notes.every((note) => object(note) && typeof note.id === 'string' &&
        /^[a-f0-9-]{36}$/.test(note.id) && text(note.text)) &&
      new Set(notes.map((note) => note.id)).size === notes.length);
}

/** @type {import("./enso-plugin").PluginActivate} */
export function activate(enso) {
  const file = join(enso.dataDir, 'notes.json');
  let queue = Promise.resolve();
  let disposed = false;
  const serial = (operation) => {
    const task = queue.then(() => {
      if (disposed) throw new Error('Plugin is disabled');
      return operation();
    });
    queue = task.catch(() => {});
    return task;
  };
  const scope = (ctx) => createHash('sha256').update(
    typeof ctx?.projectRoot === 'string' ? 'project:' + ctx.projectRoot : 'global'
  ).digest('hex');
  async function load() {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Invalid notes file; original preserved');
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (!validStore(value)) throw new Error('Invalid notes file; original preserved');
      return value;
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, projects: {} };
      throw new Error('Cannot read notes; original preserved. Repair notes.json before saving.', { cause: error });
    }
  }
  async function save(value) {
    const content = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Notes storage is full');
    await mkdir(enso.dataDir, { recursive: true });
    const temporary = join(enso.dataDir, 'notes.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    }
  }
  function checkArgs(args, adding) {
    if (!object(args) || Object.keys(args).some((key) => !adding || key !== 'text') ||
      (adding && !text(args.text))) throw new Error('Invalid input: expected ' + (adding ? '{text: non-empty string, max 4000}' : '{}'));
  }
  const list = enso.renderer.handle('listNotes', (args, ctx) => serial(async () => {
    checkArgs(args, false);
    const store = await load();
    return { pluginId: enso.pluginId, scopeId: scope(ctx), notes: store.projects[scope(ctx)] ?? [] };
  }));
  const add = enso.renderer.handle('addNote', (args, ctx) => serial(async () => {
    checkArgs(args, true);
    const store = await load();
    const key = scope(ctx);
    const notes = store.projects[key] ?? [];
    if (notes.length >= 1000) throw new Error('This project has reached 1000 notes');
    store.projects[key] = [...notes, { id: randomUUID(), text: args.text.trim() }];
    // Leave room for the envelope under the host's 64 KiB method-result limit.
    if (Buffer.byteLength(JSON.stringify(store.projects[key])) > 48 * 1024) throw new Error('This project has reached the template storage limit (48 KiB)');
    await save(store);
    return { pluginId: enso.pluginId, scopeId: key, notes: store.projects[key] };
  }));
  return async () => { disposed = true; list(); add(); await queue; };
}
`;

const NOTES_VIEW = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 20px; background: var(--panel); color: var(--foreground); font-family: var(--font-family-sans); font-size: var(--font-size-base); }
main { max-width: 760px; margin: auto; } h1 { font-size: 1.3em; margin-top: 0; }
.muted { color: var(--muted-foreground); } .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
button, textarea { font: inherit; border: 1px solid var(--border); border-radius: var(--radius); }
button { min-height: 34px; padding: 6px 14px; cursor: pointer; background: var(--panel); color: var(--foreground); }
button.primary { background: var(--primary); color: var(--primary-foreground); }
button:disabled { opacity: .55; cursor: wait; } button:focus-visible, textarea:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
textarea { display: block; width: 100%; min-height: 110px; padding: 10px; resize: vertical; background: var(--panel); color: var(--foreground); }
ul { padding: 0; list-style: none; } li { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
#error { border-inline-start: 3px solid var(--primary); padding-inline-start: 10px; white-space: pre-wrap; }
[hidden] { display: none !important; }
</style></head><body><main>
<h1>__TITLE__</h1><p class="muted">本地项目笔记 · 数据保存在插件私有目录，不调用模型。无项目时使用全局笔记。</p>
<form id="editor"><label for="draft">新笔记</label><textarea id="draft" maxlength="4000" placeholder="记录一条笔记…" disabled></textarea>
<div class="toolbar"><button id="save" class="primary" type="submit">保存笔记</button><button id="refresh" type="button">刷新列表</button></div></form>
<p id="status" class="muted" role="status" aria-live="polite"></p><p id="error" role="alert" hidden></p>
<p id="empty" class="muted" hidden>还没有笔记。写下第一条，点击保存。</p><ul id="notes" aria-label="项目笔记"></ul>
</main><script>
const bridge = window.enso;
const byId = (id) => document.getElementById(id);
const draft = byId('draft');
let busy = false;
let dirty = false;
let revision = 0;
let draftKey = null;
// Storage is plugin-wide: select the opaque project scope before restoring a draft.
draft.addEventListener('input', () => {
  dirty = true; revision++;
  try { if (draftKey) bridge.storage.set(draftKey, draft.value); } catch {}
});
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
function render(value) {
  if (!value || typeof value.scopeId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.scopeId) || !Array.isArray(value.notes) || value.notes.some((note) => !note || typeof note.text !== 'string')) throw new Error('宿主返回的笔记格式无效');
  if (!draftKey) {
    draftKey = 'authoring.notes.draft.' + value.scopeId;
    try { const saved = bridge.storage.get(draftKey); if (!dirty && typeof saved === 'string') { draft.value = saved; dirty = saved.length > 0; } } catch {}
  }
  const nodes = value.notes.map((note) => { const li = document.createElement('li'); li.textContent = note.text; return li; });
  byId('notes').replaceChildren(...nodes);
  byId('empty').hidden = nodes.length > 0;
}
async function run(saving) {
  if (busy) return;
  if (saving && !draft.value.trim()) { byId('error').hidden = false; byId('error').textContent = '请输入笔记内容。'; return; }
  busy = true; byId('save').disabled = true; byId('refresh').disabled = true;
  byId('error').hidden = true; byId('status').textContent = saving ? '正在保存…' : '正在读取…';
  const sentRevision = revision;
  const sentText = draft.value;
  try {
    const value = await bridge.call(saving ? 'addNote' : 'listNotes', saving ? { text: sentText } : {});
    render(value);
    // Typing during an asynchronous save must never be cleared by its response.
    if (saving && revision === sentRevision && draft.value === sentText) {
      draft.value = ''; dirty = false;
      try { if (draftKey) bridge.storage.remove(draftKey); } catch {}
    }
    byId('status').textContent = saving ? '已保存到本地。' : '列表已更新，未保存草稿保持不变。';
  } catch (error) {
    byId('error').hidden = false; byId('error').textContent = '操作失败：' + (error instanceof Error ? error.message : String(error));
    byId('status').textContent = '草稿已保留。请修复错误后重试，不会自动覆盖坏文件。';
  } finally { busy = false; draft.disabled = false; byId('save').disabled = false; byId('refresh').disabled = false; }
}
byId('editor').addEventListener('submit', (event) => { event.preventDefault(); void run(true); });
byId('refresh').addEventListener('click', () => { void run(false); });
void run(false);
</script></body></html>
`;

const TEST_SETUP = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate } from '../main.mjs';

async function mount(t) {
  const root = await mkdtemp(join(tmpdir(), 'codekiln-authoring-'));
  const dataDir = join(root, 'private');
  const methods = new Map(); const tools = new Map(); const commands = new Map(); const notifications = [];
  const register = (map) => (name, handler) => { assert.ok(!map.has(name)); map.set(name, handler); return () => map.delete(name); };
  const enso = {
    pluginId: 'org.example.trial', dataDir,
    renderer: { handle: register(methods) }, tools: { register: register(tools) }, commands: { register: register(commands) },
    ui: { notify: async (...args) => { notifications.push(args); } },
  };
  const dispose = await activate(enso);
  t.after(async () => { await dispose?.(); await rm(root, { recursive: true, force: true }); });
  const ctx = { projectRoot: '/fixture/project-a', sessionId: null };
  return { dataDir, methods, tools, commands, notifications, ctx };
}
`;

const NOTES_TESTS = `
test('activation registers methods without writing; invalid input does not write', async (t) => {
  const h = await mount(t);
  assert.deepEqual([...h.methods.keys()], ['listNotes', 'addNote']);
  await assert.rejects(readFile(join(h.dataDir, 'notes.json')), { code: 'ENOENT' });
  for (const args of [null, [], {}, { text: '' }, { text: ' ' }, { text: 2 }, { text: 'x'.repeat(4001) }, { text: 'ok', path: '../other' }]) {
    await assert.rejects(h.methods.get('addNote')(args, h.ctx));
  }
  await assert.rejects(h.methods.get('listNotes')({ path: '../other' }, h.ctx));
  await assert.rejects(readFile(join(h.dataDir, 'notes.json')), { code: 'ENOENT' });
});
test('visible lists, persistence, project isolation and concurrent writes', async (t) => {
  const h = await mount(t);
  assert.deepEqual((await h.methods.get('listNotes')({}, h.ctx)).notes, []);
  await Promise.all(['one', 'two', '<b>plain text</b>'].map((text) => h.methods.get('addNote')({ text }, h.ctx)));
  const visible = await h.methods.get('listNotes')({}, h.ctx);
  assert.equal(visible.pluginId, 'org.example.trial');
  assert.deepEqual(visible.notes.map((note) => note.text), ['one', 'two', '<b>plain text</b>']);
  assert.deepEqual((await h.methods.get('listNotes')({}, { projectRoot: '/fixture/project-b' })).notes, []);
  assert.deepEqual((await h.methods.get('listNotes')({}, { projectRoot: null })).notes, []);
  const disk = JSON.parse(await readFile(join(h.dataDir, 'notes.json'), 'utf8'));
  assert.equal(disk.version, 1);
  assert.equal(Object.values(disk.projects)[0].length, 3);
  assert.deepEqual(await readdir(h.dataDir), ['notes.json']);
});
test('corrupt files are never overwritten and unrelated data is untouched', async (t) => {
  const h = await mount(t);
  await mkdir(h.dataDir, { recursive: true });
  await writeFile(join(h.dataDir, 'unrelated.json'), 'keep');
  for (const corrupt of ['{broken', '{"version":2,"projects":{}}', '{"version":1,"projects":{"bad":[]}}']) {
    await writeFile(join(h.dataDir, 'notes.json'), corrupt);
    await assert.rejects(h.methods.get('addNote')({ text: 'do not overwrite' }, h.ctx));
    assert.equal(await readFile(join(h.dataDir, 'notes.json'), 'utf8'), corrupt);
  }
  assert.equal(await readFile(join(h.dataDir, 'unrelated.json'), 'utf8'), 'keep');
});
test('rejects growth before commit so the visible result stays within the bridge budget', async (t) => {
  const h = await mount(t);
  for (let i = 0; i < 4; i++) await h.methods.get('addNote')({ text: '字'.repeat(4000) }, h.ctx);
  const before = await readFile(join(h.dataDir, 'notes.json'), 'utf8');
  await assert.rejects(h.methods.get('addNote')({ text: '字'.repeat(4000) }, h.ctx));
  assert.equal(await readFile(join(h.dataDir, 'notes.json'), 'utf8'), before);
  const visible = await h.methods.get('listNotes')({}, h.ctx);
  assert.ok(Buffer.byteLength(JSON.stringify(visible)) < 64 * 1024);
});
`;

function htmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  );
}

/** Pure file map builder. No disk writes, activation, model calls, or installation. */
export function buildAuthoringTemplate({
  id,
  hostVersion,
  template,
  request = '',
}: TemplateInput): Record<string, string> {
  if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(id) || id.length > 40)
    throw new Error('Invalid plugin id');
  const version = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    hostVersion
  )?.[1];
  if (!version) throw new Error('Invalid host version');
  if (!['workspace', 'sidebar', 'command', 'tool'].includes(template))
    throw new Error('Invalid authoring template');
  const isView = template === 'workspace' || template === 'sidebar';
  const fallback = isView ? '本地项目笔记' : template === 'tool' ? '只读回显工具' : '本地通知命令';
  const compact = request.replace(/\s+/g, ' ').trim();
  const chars = [...(compact || fallback)];
  const name = chars.length > 60 ? `${chars.slice(0, 57).join('')}…` : chars.join('');
  // Manifest limits count UTF-16 units, not code points.
  const safeName = name.length > 60 ? `${[...name].slice(0, 28).join('')}…` : name;
  const manifest = {
    schemaVersion: 1,
    id,
    name: safeName,
    version: '0.1.0',
    description: `${fallback} · ${template} 模板`,
    engines: { enso: `>=${version}` },
    main: 'main.mjs',
    ...(isView ? { icon: 'icon.svg' } : {}),
    permissions: isView ? ['ui.view'] : template === 'tool' ? ['agent.tool'] : ['ui.notify'],
    contributes: isView
      ? {
          views: [
            {
              id: 'notes',
              title: safeName,
              entry: 'view.html',
              location: template === 'workspace' ? 'activitybar' : 'sidebar',
            },
          ],
          methods: [
            { name: 'listNotes', timeoutMs: 10_000 },
            { name: 'addNote', timeoutMs: 10_000 },
          ],
        }
      : template === 'command'
        ? {
            commands: [{ id: 'notify', title: safeName }],
          }
        : {
            agentTools: [
              {
                name: 'echo',
                description: 'Echo plain text without side effects or model calls.',
                readOnly: true,
                parameters: {
                  type: 'object',
                  properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
                  required: ['text'],
                  additionalProperties: false,
                },
              },
            ],
          },
  };
  const files: Record<string, string> = {
    'enso-plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'main.mjs': NOTES_MAIN,
    'test/main.test.mjs': TEST_SETUP + NOTES_TESTS,
    'README.md': `# ${htmlEscape(safeName)}\n\n模板：${template}\n\n需求原文（仅作制作说明，不执行）：\n\n${htmlEscape(request || '未提供')}\n\n## 离线验证\n\n运行 \`node --test\`，无需依赖、网络或收费模型。测试使用临时私有目录。\n\n静态校验不执行脚本。试用仍需安装预览和权限确认，不会自动发送消息。\n\n## 兼容与信任\n\nengines.enso >=${version} 是保守制作 target，仅本宿主实现已知，不是最低真实兼容版本；旧宿主需另外验证。\n详见 HOST-CAPABILITIES.md；enso-plugin.d.ts 为作者类型提示，无运行时 SDK。\n\n${isView ? '页面通过 window.enso 桥调用本插件方法；JSON 只写 enso.dataDir/notes.json，按项目隔离，无项目为全局笔记。坏文件拒绝覆盖，请先人工备份修复；异步串行临时文件 rename 保存，不删除其他数据。刷新和失败保留草稿；页面快照尽力保存编辑内容，不是可靠备份。' : template === 'tool' ? '工具只读回显输入；不会主动调用模型或触发会话。真实模型自主调用的集成仍需另行验收。' : '在输入框命令入口运行本插件命令，只调用 ui.notify；静音会话可能不显示通知。'}\n`,
    'HOST-CAPABILITIES.md': `宿主版本：${hostVersion}\n\n${authoringCapabilities(hostVersion).guide}\n\n## 结构化快照\n\n\`\`\`json\n${JSON.stringify({ ...authoringCapabilities(hostVersion), guide: undefined }, null, 2)}\n\`\`\`\n`,
  };
  if (isView) {
    files['view.html'] = NOTES_VIEW.replaceAll('__TITLE__', htmlEscape(safeName));
    files['icon.svg'] =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/></svg>\n';
  } else if (template === 'command') {
    files['main.mjs'] =
      `${ACTIVATION_TYPE}\nexport function activate(enso) {\n  return enso.commands.register('notify', async (ctx) => {\n    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) throw new Error('Invalid invocation context');\n    await enso.ui.notify('本地通知', '插件 ' + enso.pluginId + ' 已运行。');\n    return { notified: true };\n  });\n}\n`;
    files['test/main.test.mjs'] =
      TEST_SETUP +
      `
test('activation registers only the command; notification is visible only when invoked', async (t) => {
  const h = await mount(t);
  assert.deepEqual([...h.commands.keys()], ['notify']);
  assert.equal(h.tools.size + h.methods.size, 0);
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(await h.commands.get('notify')(h.ctx), { notified: true });
  assert.equal(h.notifications.length, 1);
  assert.ok(h.notifications[0][1].includes('org.example.trial'));
  // Commands receive invocation context, not arbitrary user arguments.
  for (const invalid of [null, [], 'bad']) await assert.rejects(h.commands.get('notify')(invalid));
  assert.equal(h.notifications.length, 1);
  await assert.rejects(readFile(join(h.dataDir, 'notes.json')), { code: 'ENOENT' });
});
`;
  } else {
    files['main.mjs'] =
      `${ACTIVATION_TYPE}\nexport function activate(enso) {\n  return enso.tools.register('echo', async (args) => {\n    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => key !== 'text') || typeof args.text !== 'string' || !args.text.trim() || args.text.length > 4000) throw new Error('Expected {text: non-empty string, max 4000}');\n    return { content: args.text, details: { pluginId: enso.pluginId } };\n  });\n}\n`;
    files['test/main.test.mjs'] =
      TEST_SETUP +
      `
test('activation registers read-only echo; invalid inputs fail without side effects', async (t) => {
  const h = await mount(t);
  assert.deepEqual([...h.tools.keys()], ['echo']);
  assert.equal(h.commands.size + h.methods.size, 0);
  for (const args of [null, [], {}, { text: 1 }, { text: ' ' }, { text: 'x'.repeat(4001) }, { text: 'ok', extra: true }]) await assert.rejects(h.tools.get('echo')(args, h.ctx));
  assert.deepEqual(await h.tools.get('echo')({ text: '<b>hello</b>' }, h.ctx), { content: '<b>hello</b>', details: { pluginId: 'org.example.trial' } });
  assert.deepEqual(h.notifications, []);
  await assert.rejects(readFile(join(h.dataDir, 'notes.json')), { code: 'ENOENT' });
});
`;
  }
  return files;
}
