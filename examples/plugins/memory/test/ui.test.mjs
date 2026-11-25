import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { activate } from '../main.mjs';

async function mount(t, { hidden = false } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'memory-ui-'));
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  t.after(async () => {
    await window.happyDOM.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const methods = new Map(),
    listeners = new Map();
  await activate({
    dataDir,
    tools: { register() {} },
    events: { on() {} },
    commands: { register() {} },
    config: { get: async () => ({ model: 'session' }) },
    renderer: { handle: (name, fn) => methods.set(name, fn) },
    ui: {
      view: { emit: async () => {} },
      notify: async () => {},
      clipboard: { writeText: async () => {} },
    },
  });
  const ctx = { sessionId: 'ui', projectRoot: '/project/a' };
  const calls = [];
  window.enso = {
    theme: 'light',
    onTheme() {},
    on: (name, fn) => listeners.set(name, fn),
    call: async (name, args) => {
      calls.push({ name, args });
      return methods.get(name)(args ?? {}, ctx);
    },
  };
  const html = await readFile(new URL('../memory.html', import.meta.url), 'utf8');
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''));
  window.document.body.getBoundingClientRect = () => ({ width: hidden ? 0 : 360 });
  window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  return {
    window,
    ctx,
    methods,
    listeners,
    calls,
    settle,
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

test('restoring many hidden sidebar instances does not call the host until one becomes visible', async (t) => {
  const f = await mount(t, { hidden: true });
  assert.equal(f.calls.length, 0);
  f.$('items').ownerDocument.body.getBoundingClientRect = () => ({ width: 360 });
  f.window.dispatchEvent(new f.window.Event('resize'));
  await f.settle();
  assert.equal(f.calls.filter((row) => row.name === 'status').length, 1);
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
