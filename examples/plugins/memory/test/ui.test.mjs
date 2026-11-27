import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { activate } from '../main.mjs';

async function mount(t, { hidden = false, width = 360 } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'memory-ui-'));
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  t.after(async () => {
    await window.happyDOM.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const methods = new Map(),
    listeners = new Map(),
    copied = [],
    injections = [];
  await activate({
    dataDir,
    tools: { register() {} },
    events: { on() {} },
    commands: { register() {} },
    config: { get: async () => ({ model: 'session' }) },
    renderer: { handle: (name, fn) => methods.set(name, fn) },
    session: {
      list: async () => ({
        current: 'target',
        sessions: [{ id: 'target', title: '本项目会话', state: 'idle' }],
      }),
      inject: async (input) => {
        injections.push(input);
        return null;
      },
    },
    ui: {
      view: { emit: async () => {} },
      notify: async () => {},
      clipboard: { writeText: async (text) => void copied.push(text) },
    },
  });
  const ctx = { sessionId: 'ui', projectRoot: '/project/a' };
  const calls = [];
  window.enso = {
    theme: 'light',
    onTheme() {},
    on: (name, fn) => listeners.set(name, fn),
    projects: {
      list: async () => ({
        current: { projectId: 'a' },
        projects: [
          { key: 'a', name: '项目A', kind: 'project', context: { projectId: 'a' } },
          { key: 'b', name: '项目B', kind: 'project', context: { projectId: 'b' } },
        ],
      }),
      select: async (context) => {
        ctx.projectRoot = context === null ? null : `/project/${context.projectId}`;
        return { current: context };
      },
    },
    call: async (name, args) => {
      calls.push({ name, args });
      return methods.get(name)(args ?? {}, ctx);
    },
  };
  const html = await readFile(new URL('../memory.html', import.meta.url), 'utf8');
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''));
  window.document.body.getBoundingClientRect = () => ({ width: hidden ? 0 : width });
  window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  // 渲染是异步的（status → read → context），固定 40ms 在负载高时会假失败。
  const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
  await settle();
  return {
    window,
    ctx,
    methods,
    listeners,
    calls,
    copied,
    injections,
    settle,
    dataDir,
    $: (id) => window.document.getElementById(id),
    clickTab: (tab) => window.document.querySelector(`[data-tab="${tab}"]`).click(),
  };
}

test('all five tabs render; creation, edit, pin, search, daily edit and recovery work through actual methods', async (t) => {
  const f = await mount(t);
  assert.match(f.$('items').textContent, /这里还很安静/);
  f.$('add').click();
  f.$('edit-content').value = '界面添加的记忆 <img src=x onerror=alert(1)>';
  f.$('editor-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await f.settle();
  assert.equal(f.$('items').querySelector('img'), null);
  assert.match(f.$('items').textContent, /界面添加的记忆/);
  f.$('items').querySelector('button').click();
  f.$('edit-content').value = '界面编辑后的记忆';
  f.$('editor-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await f.settle();
  assert.match(f.$('items').textContent, /编辑后的记忆/);
  f.$('items').querySelectorAll('button')[1].click();
  await f.settle();
  assert.match(f.$('items').textContent, /◆ 置顶/);
  f.clickTab('daily');
  await f.settle();
  f.$('add').click();
  f.$('edit-content').value = '今日完成UI回归';
  f.$('editor-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await f.settle();
  f.$('items').querySelector('button').click();
  f.$('edit-content').value = '今日更新UI回归';
  f.$('editor-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await f.settle();
  assert.match(f.$('items').textContent, /更新UI回归/);
  const daily = await f.methods.get('read')({ target: 'daily' }, f.ctx);
  assert.equal(daily.count, 1, 'editing a daily record must not append a duplicate');
  f.$('items').querySelectorAll('button')[1].click();
  f.$('confirm-yes').click();
  await f.settle();
  f.clickTab('trash');
  await f.settle();
  assert.match(f.$('items').textContent, /更新UI回归/);
  f.$('items').querySelector('button').click();
  await f.settle();
  assert.match(f.$('items').textContent, /已恢复/);
  f.clickTab('todos');
  await f.settle();
  assert.equal(f.$('todo-actions').hidden, false);
  f.clickTab('settings');
  await f.settle();
  assert.equal(f.$('settings-panel').hidden, false);
  f.$('autoLearn').checked = true;
  f.$('settings-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await f.settle();
  assert.equal((await f.methods.get('status')({}, f.ctx)).settings.autoLearn, true);
});

test('rapid tabs reuse status and hidden sidebar views do not flood the host', async (t) => {
  const f = await mount(t);
  const before = f.calls.filter((row) => row.name === 'status').length;
  for (const tab of ['daily', 'todos', 'trash', 'memory', 'settings', 'memory']) f.clickTab(tab);
  await f.settle();
  assert.equal(f.calls.filter((row) => row.name === 'status').length, before);
  const calls = f.calls.length;
  f.$('items').ownerDocument.body.getBoundingClientRect = () => ({ width: 0 });
  f.listeners.get('memory-changed')({});
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(f.calls.length, calls);
  f.$('items').ownerDocument.body.getBoundingClientRect = () => ({ width: 360 });
  f.window.dispatchEvent(new f.window.Event('resize'));
  await f.settle();
  assert.ok(f.calls.length > calls);
});

test('project selection actually changes visible records and scope filtering is independent', async (t) => {
  const f = await mount(t);
  await f.methods.get('save')({ content: 'A项目私有记忆' }, f.ctx);
  await f.methods.get('save')(
    { content: 'B项目私有记忆' },
    { ...f.ctx, projectRoot: '/project/b' }
  );
  await f.methods.get('save')({ content: '全局记忆', scope: 'global' }, f.ctx);
  f.$('refresh').click();
  await f.settle();
  const ids = [...f.window.document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'DOM ids must be unique');
  assert.match(f.$('items').textContent, /A项目私有记忆/);
  f.$('scope-filter').value = 'global';
  f.$('scope-filter').dispatchEvent(new f.window.Event('change'));
  await f.settle();
  assert.match(f.$('items').textContent, /全局记忆/);
  assert.doesNotMatch(f.$('items').textContent, /A项目私有记忆/);
  f.$('project-control').click();
  assert.equal(f.$('project-dialog').open, true);
  f.$('project-choices').querySelector('[data-project-key="b"]').click();
  await f.settle();
  assert.match(f.$('items').textContent, /B项目私有记忆/);
  assert.doesNotMatch(f.$('items').textContent, /A项目私有记忆/);
  f.$('project-switch').value = 'global';
  f.$('project-switch').dispatchEvent(new f.window.Event('change'));
  await f.settle();
  assert.match(f.$('items').textContent, /全局记忆/);
  assert.doesNotMatch(f.$('items').textContent, /项目私有记忆/);
});

test('an open editor cannot be silently retargeted to another project', async (t) => {
  const f = await mount(t);
  f.$('add').click();
  f.$('edit-content').value = '未保存草稿';
  f.$('project-switch').value = 'b';
  f.$('project-switch').dispatchEvent(new f.window.Event('change'));
  await f.settle();
  assert.equal(f.ctx.projectRoot, '/project/a');
  assert.equal(f.$('edit-content').value, '未保存草稿');
  assert.match(f.$('notice').textContent, /保存|取消/);
});

test('a delayed project switch cannot open a new editor with the old scope', async (t) => {
  const f = await mount(t);
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  const select = f.window.enso.projects.select;
  f.window.enso.projects.select = async (context) => {
    await waiting;
    return select(context);
  };
  f.$('project-switch').value = 'b';
  f.$('project-switch').dispatchEvent(new f.window.Event('change'));
  f.$('add').click();
  const opened = f.$('editor').open;
  finish();
  await f.settle();
  assert.equal(opened, false, 'new editors must be blocked for the entire pending switch');
  assert.equal(f.ctx.projectRoot, '/project/b');
});

test('send picker really dispatches to the chosen session and shows confirmed doing state', async (t) => {
  const f = await mount(t);
  f.clickTab('todos');
  await f.settle();
  f.$('add').click();
  f.$('edit-content').value = '直接交给会话执行';
  f.$('save-edit').click();
  await f.settle();
  f.$('items').querySelector('[aria-label="发到会话"]').click();
  await f.settle();
  assert.equal(f.$('send-dialog').open, true);
  assert.match(f.$('send-list').textContent, /本项目会话/);
  assert.equal(f.$('send-go').disabled, false);
  f.$('send-go').click();
  await f.settle();
  assert.equal(f.$('send-dialog').open, false);
  assert.equal(f.injections.length, 1);
  assert.equal(f.injections[0].sessionId, 'target');
  assert.equal(f.injections[0].sameWorkspace, true);
  assert.match(f.$('notice').textContent, /确认接收/);
  assert.match(f.$('items').querySelector('.todo__flag').textContent, /进行中/);
});

test('restoring many hidden sidebar instances does not call the host until one becomes visible', async (t) => {
  const f = await mount(t, { hidden: true });
  assert.equal(f.calls.length, 0);
  f.$('items').ownerDocument.body.getBoundingClientRect = () => ({ width: 360 });
  f.window.dispatchEvent(new f.window.Event('resize'));
  await f.settle();
  assert.equal(f.calls.filter((row) => row.name === 'status').length, 1);
});

test('the context ledger shows what the next turn will carry, and the cap that limits it', async (t) => {
  const f = await mount(t, { width: 1400 });
  assert.equal(f.$('pack').hidden, false);
  await f.methods.get('save')({ content: '账本里的第一条记忆', pinned: true }, f.ctx);
  f.$('refresh').click();
  await f.settle();

  const report = await f.methods.get('context')({}, f.ctx);
  assert.equal(f.$('pack-total').textContent, report.total.toLocaleString('en-US'));
  assert.equal(f.$('pack-budget').textContent, `/ ${report.budget.toLocaleString('en-US')} 字`);
  const rows = [...f.window.document.querySelectorAll('#pack-legend .pack__row')];
  assert.deepEqual(
    rows.map((row) => row.dataset.key),
    ['todos', 'today', 'memory', 'related', 'yesterday']
  );
  assert.equal(rows[3].dataset.empty, 'true', 'related memories are off in stable mode');
  assert.equal(f.$('pack-picked').textContent, '1');
  assert.match(f.$('pack-skip-label').textContent, /全部收下了/);
  assert.ok(f.$('budget-value').textContent.includes(`${report.total.toLocaleString('en-US')}`));
});

test('a narrow workspace drops the ledger instead of squeezing the list', async (t) => {
  const f = await mount(t, { width: 900 });
  assert.equal(f.$('pack').hidden, true);
});

test('memory UI uses host colors, emphasis and typography even when the light/dark mode is unchanged', async (t) => {
  const f = await mount(t);
  const root = f.window.document.documentElement;
  root.style.setProperty('--panel', 'rgb(12, 34, 56)');
  root.style.setProperty('--foreground', 'rgb(231, 232, 233)');
  root.style.setProperty('--primary', 'rgb(234, 95, 25)');
  root.style.setProperty('--primary-foreground', 'rgb(255, 255, 255)');
  root.style.setProperty('--font-family-sans', '"Custom UI", system-ui');
  root.style.setProperty('--font-size-base', '16px');
  assert.equal(
    f.window.getComputedStyle(f.window.document.body).backgroundColor,
    'rgb(12, 34, 56)'
  );
  assert.equal(f.window.getComputedStyle(f.window.document.body).color, 'rgb(231, 232, 233)');
  assert.equal(f.window.getComputedStyle(f.$('add')).backgroundColor, 'rgb(234, 95, 25)');
  assert.match(f.window.getComputedStyle(f.window.document.body).fontFamily, /Custom UI/);
  root.dataset.theme = 'dark';
  assert.equal(
    f.window.getComputedStyle(f.window.document.body).backgroundColor,
    'rgb(12, 34, 56)'
  );
});

test('adding a todo and a memory from the dialog actually persists and shows up', async (t) => {
  const f = await mount(t);
  f.clickTab('todos');
  await f.settle();
  f.$('add').click();
  f.$('edit-content').value = '从对话框添加的待办';
  f.$('editor-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await f.settle();
  assert.equal(f.$('editor').open, false, 'dialog closes after saving');
  assert.equal(f.$('editor-error').textContent, '');
  assert.match(f.$('items').textContent, /从对话框添加的待办/);
  const saved = await f.methods.get('read')({ target: 'scratchpad' }, f.ctx);
  assert.equal(saved.count, 1);
});

test('save buttons work on click without form submission (the host sandbox has no allow-forms)', async (t) => {
  const f = await mount(t);
  // 结构保证：依赖 submit 事件在宿主里永远不会触发。
  assert.equal(f.$('save-edit').getAttribute('type'), 'button');
  assert.equal(f.$('save-settings').getAttribute('type'), 'button');

  f.$('add').click();
  f.$('edit-content').value = '点击保存的记忆';
  f.$('save-edit').click();
  await f.settle();
  assert.equal(f.$('editor').open, false);
  assert.match(f.$('items').textContent, /点击保存的记忆/);

  f.clickTab('settings');
  await f.settle();
  f.$('maxMemories').value = '17';
  f.$('save-settings').click();
  await f.settle();
  assert.equal((await f.methods.get('status')({}, f.ctx)).settings.maxMemories, 17);
});

test('todos accept pasted images: only ids are stored, the list shows thumbnails and opens a big view', async (t) => {
  const f = await mount(t);
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  // 沙箱视图里没有真实解码器：把压缩管线换成能产出合法 PNG 头的桩。
  f.window.createImageBitmap = async () => ({ width: 12, height: 8, close() {} });
  f.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  f.window.HTMLCanvasElement.prototype.toBlob = function toBlob(resolve) {
    resolve(new f.window.Blob([png], { type: 'image/webp' }));
  };
  f.clickTab('todos');
  await f.settle();
  f.$('add').click();
  assert.equal(f.$('shots-field').hidden, false, '待办编辑器才有图片字段');
  const file = new f.window.File([png], 'shot.png', { type: 'image/png' });
  const paste = new f.window.Event('paste', { bubbles: true, cancelable: true });
  paste.clipboardData = {
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
  };
  f.$('editor').dispatchEvent(paste);
  await f.settle();
  await f.settle();
  const pending = f.$('shots').querySelectorAll('.shot--edit');
  assert.equal(pending.length, 1, '粘贴的图片进入编辑器图片条');
  assert.match(pending[0].querySelector('img').src, /^data:image\/png;base64,/);

  f.$('edit-content').value = '照着截图改字段';
  f.$('save-edit').click();
  await f.settle();
  assert.equal(f.$('editor').open, false);
  assert.equal(f.$('editor-error').textContent, '');
  const saved = await f.methods.get('read')({ target: 'scratchpad' }, f.ctx);
  assert.equal(saved.items[0].images.length, 1);
  const state = await readFile(join(f.dataDir, 'memory.json'), 'utf8');
  assert.ok(!state.includes('iVBORw0KGgo'), '正文文件里不存图片字节');
  assert.equal((await readdir(join(f.dataDir, 'attachments'))).length, 2, '原图与缩略图各一个文件');

  const thumbs = f.$('items').querySelectorAll('.todo__shots img');
  assert.equal(thumbs.length, 1, '列表里出现缩略图');
  assert.match(thumbs[0].src, /^data:image\/png;base64,/);
  f.$('items').querySelector('.todo__shots button').click();
  await f.settle();
  assert.equal(f.$('viewer').open, true);
  assert.match(f.$('viewer-img').src, /^data:image\/png;base64,/);
  f.$('viewer').close();

  f.clickTab('memory');
  await f.settle();
  f.$('add').click();
  assert.equal(f.$('shots-field').hidden, true, '长期记忆编辑器不带图片字段');
});

test('a todo can be started, filtered as in-progress, and copied out as a session instruction', async (t) => {
  const f = await mount(t);
  f.clickTab('todos');
  await f.settle();
  f.$('add').click();
  f.$('edit-content').value = '按截图把货物规格改成整车必填';
  f.$('save-edit').click();
  await f.settle();
  const row = () => f.$('items').querySelector('.todo');
  assert.equal(row().querySelector('.check').dataset.status, 'todo');
  assert.equal(row().querySelector('.todo__flag'), null);

  row().querySelector('[aria-label="开始，标为进行中"]').click();
  await f.settle();
  assert.equal(row().querySelector('.check').dataset.status, 'doing');
  assert.match(row().querySelector('.todo__flag').textContent, /进行中/);

  f.$('todo-filter').value = 'doing';
  f.$('todo-filter').dispatchEvent(new f.window.Event('change'));
  await f.settle();
  assert.equal(f.$('items').querySelectorAll('.todo').length, 1);
  f.$('todo-filter').value = 'done';
  f.$('todo-filter').dispatchEvent(new f.window.Event('change'));
  await f.settle();
  assert.equal(f.$('items').querySelectorAll('.todo').length, 0);
  f.$('todo-filter').value = 'all';
  f.$('todo-filter').dispatchEvent(new f.window.Event('change'));
  await f.settle();

  row().querySelector('[aria-label="发到会话"]').click();
  await f.settle();
  assert.equal(f.$('send-dialog').open, true);
  assert.match(f.$('send-note').value, /整车必填/);
  f.$('send-note').value = '先改发布页，再回头改这个';
  f.$('send-copy').click();
  await f.settle();
  assert.equal(f.$('send-dialog').open, false);
  assert.equal(f.$('send-error').textContent, '');
  assert.equal(f.copied.length, 1);
  assert.match(f.copied[0], /先改发布页，再回头改这个/);
  assert.match(f.copied[0], /plugin_codekiln-memory__scratchpad/);
  assert.match(f.copied[0], /action=done/);
  const saved = await f.methods.get('read')({ target: 'scratchpad' }, f.ctx);
  assert.equal(saved.items[0].status, 'doing');
});
