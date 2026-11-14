import { describe, expect, it } from 'vitest';
import {
  PLUGIN_BROWSER_OPS,
  PLUGIN_BROWSER_WRITE_OPS,
  parsePluginBrowserRequest,
  pluginBrowserUrl,
} from './browserBridge';

const ok = (args: unknown) => parsePluginBrowserRequest(args);

describe('parsePluginBrowserRequest', () => {
  it('只接受约定的 op', () => {
    expect([...PLUGIN_BROWSER_OPS]).toEqual([
      'navigate',
      'snapshot',
      'read',
      'click',
      'fill',
      'press_key',
      'inspect',
      'copy_selection',
      'insert_text',
      'read_range',
    ]);
    expect([...PLUGIN_BROWSER_WRITE_OPS]).toEqual([
      'navigate',
      'click',
      'fill',
      'press_key',
      'insert_text',
    ]);
    for (const op of ['cdp', 'evaluate', 'screenshot', 'tabs', 'downloads'])
      expect(ok({ op, params: { tabId: 'browser:1' } })).toBeNull();
  });

  it('params 必须是 object，且只允许 op/params 两个键', () => {
    expect(ok({ op: 'snapshot' })).toBeNull();
    expect(ok({ op: 'snapshot', params: [] })).toBeNull();
    expect(ok({ op: 'snapshot', params: { tabId: 'browser:1' }, script: 'alert(1)' })).toBeNull();
    expect(ok('snapshot')).toBeNull();
    expect(ok({ params: { tabId: 'browser:1' } })).toBeNull();
  });

  it('navigate 只接受 url 与 newTab', () => {
    expect(ok({ op: 'navigate', params: { url: 'https://example.com/' } })).toEqual({
      op: 'navigate',
      params: { url: 'https://example.com/' },
    });
    expect(ok({ op: 'navigate', params: { url: 'https://example.com/', newTab: true } })).toEqual({
      op: 'navigate',
      params: { url: 'https://example.com/', newTab: true },
    });
    expect(
      ok({ op: 'navigate', params: { url: 'https://example.com/', newTab: 'yes' } })
    ).toBeNull();
    expect(ok({ op: 'navigate', params: { url: '' } })).toBeNull();
    expect(
      ok({ op: 'navigate', params: { url: 'https://a.test', tabId: 'browser:1' } })
    ).toBeNull();
    expect(
      ok({ op: 'navigate', params: { url: 'https://a.test', method: 'Page.navigate' } })
    ).toBeNull();
  });

  it('read_range 只接受金山文档、受限范围与可选固定tab，不接受业务内容或选择器', () => {
    const params = { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' };
    expect(ok({ op: 'read_range', params })).toEqual({ op: 'read_range', params });
    expect(ok({ op: 'read_range', params: { ...params, tabId: 'browser:1' } })?.params.tabId).toBe(
      'browser:1'
    );
    for (const address of ['A0', 'A1:M201', 'A1:L202', 'A1;F2', 'B2:A1', '=1+1', 'A1\nB2'])
      expect(ok({ op: 'read_range', params: { ...params, address } })).toBeNull();
    for (const url of [
      'https://evil.test/l/demo',
      'https://www.kdocs.cn/account',
      'http://www.kdocs.cn/l/demo',
      'https://a:b@www.kdocs.cn/l/demo',
    ])
      expect(ok({ op: 'read_range', params: { ...params, url } })).toBeNull();
    for (const extra of [
      { text: '改状态' },
      { selector: '.edit-proxy-runs' },
      { key: 'F2' },
      { expression: 'evil()' },
      { newTab: true },
    ])
      expect(ok({ op: 'read_range', params: { ...params, ...extra } })).toBeNull();
  });

  it('其余 op 必须给 tabId', () => {
    for (const op of ['snapshot', 'read']) {
      expect(ok({ op, params: { tabId: 'browser:1-abc' } })).toEqual({
        op,
        params: { tabId: 'browser:1-abc' },
      });
      expect(ok({ op, params: {} })).toBeNull();
      expect(ok({ op, params: { tabId: '' } })).toBeNull();
      expect(ok({ op, params: { tabId: '../etc/passwd' } })).toBeNull();
    }
    expect(ok({ op: 'click', params: { tabId: 'browser:1', ref: 'e1_2' } })).toEqual({
      op: 'click',
      params: { tabId: 'browser:1', ref: 'e1_2' },
    });
    expect(ok({ op: 'click', params: { tabId: 'browser:1' } })).toBeNull();
    expect(
      ok({ op: 'click', params: { tabId: 'browser:1', ref: 'x', selector: '#a' } })
    ).toBeNull();
    expect(ok({ op: 'fill', params: { tabId: 'browser:1', ref: 'e1_2', value: 'hi' } })).toEqual({
      op: 'fill',
      params: { tabId: 'browser:1', ref: 'e1_2', value: 'hi' },
    });
    expect(ok({ op: 'fill', params: { tabId: 'browser:1', ref: 'e1_2' } })).toBeNull();
    expect(
      ok({ op: 'fill', params: { tabId: 'browser:1', ref: 'e1_2', value: 'x'.repeat(40_000) } })
    ).toBeNull();
    expect(ok({ op: 'press_key', params: { tabId: 'browser:1', key: 'Enter' } })).toEqual({
      op: 'press_key',
      params: { tabId: 'browser:1', key: 'Enter' },
    });
    expect(ok({ op: 'press_key', params: { tabId: 'browser:1' } })).toBeNull();
  });

  it('inspect 只接受 tabId 与 selector', () => {
    expect(ok({ op: 'inspect', params: { tabId: 'browser:1', selector: '#main' } })).toEqual({
      op: 'inspect',
      params: { tabId: 'browser:1', selector: '#main' },
    });
    expect(ok({ op: 'inspect', params: { tabId: 'browser:1' } })).toBeNull();
    expect(ok({ op: 'inspect', params: { tabId: 'browser:1', selector: '' } })).toBeNull();
    expect(
      ok({
        op: 'inspect',
        params: { tabId: 'browser:1', selector: '#a', method: 'Runtime.evaluate' },
      })
    ).toBeNull();
    expect(ok({ op: 'inspect', params: { tabId: 'browser:1', selector: 'a\u0000b' } })).toBeNull();
  });

  it('copy_selection 只接受 tabId，不接受键盘选择器或额外 JS 参数', () => {
    expect(ok({ op: 'copy_selection', params: { tabId: 'browser:1' } })).toEqual({
      op: 'copy_selection',
      params: { tabId: 'browser:1' },
    });
    expect(ok({ op: 'copy_selection', params: {} })).toBeNull();
    for (const extra of [
      { key: 'Meta+C' },
      { selector: '#cell' },
      { expression: 'document.body.innerText' },
      { method: 'Runtime.evaluate' },
    ])
      expect(ok({ op: 'copy_selection', params: { tabId: 'browser:1', ...extra } })).toBeNull();
  });

  it('insert_text 只接受 tabId 与 text，上限 32KB UTF-8', () => {
    expect(ok({ op: 'insert_text', params: { tabId: 'browser:1', text: '' } })).toEqual({
      op: 'insert_text',
      params: { tabId: 'browser:1', text: '' },
    });
    expect(ok({ op: 'insert_text', params: { tabId: 'browser:1', text: '需求\t数量' } })).toEqual({
      op: 'insert_text',
      params: { tabId: 'browser:1', text: '需求\t数量' },
    });
    expect(
      ok({ op: 'insert_text', params: { tabId: 'browser:1', text: 'a'.repeat(32 * 1024) } })
    ).not.toBeNull();
    expect(ok({ op: 'insert_text', params: { tabId: 'browser:1' } })).toBeNull();
    expect(ok({ op: 'insert_text', params: { tabId: 'browser:1', text: 1 } })).toBeNull();
    // 中文按 UTF-8 计算：10923 * 3 > 32KB
    expect(
      ok({ op: 'insert_text', params: { tabId: 'browser:1', text: '需'.repeat(10923) } })
    ).toBeNull();
    for (const extra of [
      { ref: 'e1_2' },
      { selector: '#edit_proxy' },
      { expression: 'document.body.innerText' },
      { key: 'Enter' },
      { enter: true },
    ])
      expect(
        ok({ op: 'insert_text', params: { tabId: 'browser:1', text: 'x', ...extra } })
      ).toBeNull();
  });
});

describe('pluginBrowserUrl', () => {
  const domains = ['example.com', 'docs.example.org'];

  it('只放行 HTTPS 与精确 host', () => {
    expect(pluginBrowserUrl('https://example.com/a?b=1', domains)?.hostname).toBe('example.com');
    expect(pluginBrowserUrl('https://EXAMPLE.com/', domains)?.hostname).toBe('example.com');
    expect(pluginBrowserUrl('https://docs.example.org/x', domains)?.hostname).toBe(
      'docs.example.org'
    );
  });

  it('拒绝 http、file、内嵌凭证与子域/通配/相似 host', () => {
    for (const raw of [
      'http://example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'https://user:pass@example.com/',
      'https://sub.example.com/',
      'https://evil-example.com/',
      'https://example.com.evil.test/',
      'https://example.co/',
      'about:blank',
      '',
      '   ',
    ])
      expect(pluginBrowserUrl(raw, domains)).toBeNull();
  });

  it('域名白名单必须非空', () => {
    expect(pluginBrowserUrl('https://example.com/', [])).toBeNull();
  });
});
