import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ dir: '', contents: [] as MockContents[], exec: async (_script: string): Promise<unknown> => 'ok', commands: [] as { method: string; params: unknown }[] }));
class MockContents extends EventEmitter {
  id = mock.contents.length + 1;
  url = '';
  inputs: unknown[] = [];
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, clear() {} };
  debugger = { isAttached: () => true, attach() {}, detach() {}, on() {}, sendCommand: async (method: string, params: unknown) => { mock.commands.push({ method, params }); return method === 'Page.captureScreenshot' ? { data: 'image' } : {}; } };
  setWindowOpenHandler() {}
  setDevToolsWebContents() {}
  openDevTools() {}
  getURL() { return this.url; }
  getUserAgent() { return 'MockAgent/1.0'; }
  getTitle() { return 'Page'; }
  isLoading() { return false; }
  isDestroyed() { return false; }
  isDevToolsOpened() { return false; }
  executeJavaScript(script: string) { return mock.exec(script); }
  async loadURL(url: string) { this.url = url; this.emit('dom-ready'); this.emit('did-navigate'); }
  sendInputEvent(input: unknown) { this.inputs.push(input); this.emit('input-event', {}, input); }
  async insertText(text: string) { this.inputs.push(text); }
  stop() {}
  close() { this.emit('destroyed'); }
}
vi.mock('../windows/createAppWindow', () => ({ getWorkbenchView: () => null }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ attachSession() {} }) }));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, isPackaged: false },
  session: { fromPartition: () => ({ on() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} }, cookies: { flushStore: async () => {} }, flushStorageData: async () => {} }) },
  WebContentsView: class {
    webContents = new MockContents();
    constructor() { mock.contents.push(this.webContents); }
    setBackgroundColor() {}
    setVisible() {}
    setBounds() {}
    getBounds() { return { x: 0, y: 0, width: 1280, height: 800 }; }
  },
}));
import { BrowserHost } from './browserHost';
mock.dir = mkdtempSync(join(tmpdir(), 'browser-capabilities-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));
beforeEach(() => { mock.contents.length = 0; mock.commands.length = 0; mock.exec = async () => 'ok'; });
const open = async () => { const host = new BrowserHost(); await host.navigate('conv', 'https://example.test'); const tabId = host.state('conv').tabId; if (!tabId) throw new Error('No tab'); return { host, tabId, contents: mock.contents[0] }; };

it('指定 tab 校验归属，manual 阻断普通会话及 raw CDP，只有 UI 可恢复', async () => {
  const { host, tabId } = await open();
  await expect(host.invoke('other', 'cdp', { tabId, method: 'Runtime.evaluate', params: {} })).rejects.toThrow(/owner|belong/);
  await host.setControl(tabId, 'conv', 'manual');
  await expect(host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate', params: {} })).rejects.toThrow(/manual|control|took over/i);
  await host.setControl(tabId, 'conv', 'agent');
  expect(await host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate', params: {} })).toEqual({});
  await host.dispose();
});
it('接管立即取消在途等待与排队输入，不等该 tab 队列', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async () => false;
  const wait = host.invoke('conv', 'wait', { tabId, kind: 'text', text: 'not here', timeoutMs: 5000 });
  const queued = host.invoke('conv', 'press_key', { tabId, key: 'Enter' });
  const rejected = Promise.all([expect(wait).rejects.toThrow(/abort|control|took over/i), expect(queued).rejects.toThrow(/abort|control|took over/i)]);
  await host.setControl(tabId, 'conv', 'manual');
  await rejected;
  expect(contents.inputs).toHaveLength(0);
  await host.dispose();
});
it('原生键盘发送不误判接管，真实输入使旧引用失效', async () => {
  const { host, tabId, contents } = await open();
  await host.invoke('conv', 'press_key', { tabId, key: 'Control+A' });
  expect(contents.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })]));
  expect(host.state(tabId).control).toBe('agent');
  contents.emit('input-event', {}, { type: 'mouseDown' });
  expect(host.state(tabId).control).toBe('manual');
  await host.dispose();
});
it('读取生成快照代际，新读使旧 ref 和游标失效', async () => {
  const { host, tabId } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return { text: 'abcdef', entries: [{ role: 'button', name: 'Save', depth: 0, ref: `e${snapshotId}_1`, kind: 'click' }], diagnostics: [], truncated: false };
  };
  const first = await host.invoke('conv', 'read_elements', { tabId }) as { entries: { ref: string }[] };
  await host.invoke('conv', 'read_text', { tabId });
  await expect(host.invoke('conv', 'click', { tabId, ref: first.entries[0].ref })).rejects.toThrow(/stale/);
  await host.dispose();
});
it('DevTools 占用 CDP 时拒绝改设备模拟，但仍允许关闭设备预览', async () => {
  const { host, tabId } = await open();
  await host.setDevice(tabId, 'conv', { enabled: true, width: 393, height: 852 });
  host.setDevTools(tabId, true);
  await expect(
    host.setDevice(tabId, 'conv', { enabled: true, width: 440, height: 956 })
  ).rejects.toThrow(/DevTools/);
  expect(host.state(tabId).device).toMatchObject({ width: 393, height: 852 });
  await expect(host.setDevice(tabId, 'conv', { enabled: false })).resolves.toMatchObject({
    device: { enabled: false },
  });
  await host.dispose();
});
it('关闭走统一路径，不在搜索或持久恢复清单留下已关闭标签', async () => {
  const { host, tabId } = await open();
  await host.invoke('conv', 'close', { tabId });
  expect(host.listSearchableTabs().some((entry) => entry.tabId === tabId)).toBe(false);
  await host.dispose();
});
