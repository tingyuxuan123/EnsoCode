import { describe, expect, it } from 'vitest';
import { parseDesignRequest } from './parsers';

const root = { kind: 'session', sessionId: 'session-1' };
describe('设计 IPC unknown 收窄', () => {
  it.each([
    'fs',
    'engine',
    'capture',
    'script',
    'storage',
    'network',
    'shell',
    'saveAs',
    'watch',
    'resolveRoot',
    'registerRuntime',
  ])('%s 拒绝脏输入', (kind) => {
    for (const raw of [null, 3, [], 'x', { op: 'unknown' }])
      expect(parseDesignRequest(kind, raw)).toBeNull();
  });
  it('重建根与文件请求，不接收附带任意路径或错误 encoding', () => {
    expect(parseDesignRequest('fs', { op: 'readFile', root, rel: 'x.vetd/design.json' })).toEqual({
      op: 'readFile',
      root,
      rel: 'x.vetd/design.json',
    });
    expect(parseDesignRequest('fs', { op: 'readFile', root, rel: '../secret' })).toBeNull();
    expect(
      parseDesignRequest('fs', { op: 'readFile', root, rel: '', absolutePath: '/etc/passwd' })
    ).toBeNull();
    expect(
      parseDesignRequest('fs', {
        op: 'writeFile',
        root,
        rel: 'x.vetd/a',
        encoding: 'hex',
        content: 'x',
      })
    ).toBeNull();
  });
  it('数组逐项校验，视口与脚本时限有界', () => {
    expect(
      parseDesignRequest('fs', { op: 'listFilesRecursive', root, rel: '', names: ['x', 2] })
    ).toBeNull();
    expect(
      parseDesignRequest('capture', {
        op: 'offscreen',
        engineId: 'e',
        path: '/',
        width: 4097,
        height: 100,
      })
    ).toBeNull();
    expect(
      parseDesignRequest('capture', {
        op: 'offscreen',
        engineId: 'e',
        path: '//evil',
        width: 100,
        height: 100,
      })
    ).toBeNull();
    expect(
      parseDesignRequest('engine', {
        op: 'install',
        root,
        designRel: 'a.vetd',
        packages: ['--prefix=/tmp'],
      })
    ).toBeNull();
  });
  it('只提供固定脚本且历史 payload 不得覆写 dir', () => {
    expect(
      parseDesignRequest('script', {
        script: 'history',
        root,
        designRel: 'a.vetd',
        payload: { cmd: 'log' },
      })
    ).not.toBeNull();
    expect(
      parseDesignRequest('script', {
        script: 'history',
        root,
        designRel: 'a.vetd',
        payload: { dir: '/tmp', cmd: 'log' },
      })
    ).toBeNull();
    expect(parseDesignRequest('script', { script: 'exec', root, designRel: 'a.vetd' })).toBeNull();
  });
  it('历史字段逐项收窄，不把任意路径或未识别命令传给 runner', () => {
    for (const payload of [
      { cmd: 'unknown' },
      { cmd: 'log', limit: -1 },
      { cmd: 'show', sha: 'a'.repeat(40), filepath: '../secret' },
      { cmd: 'commit', title: 4 },
      { cmd: 'restore', sha: [] },
    ])
      expect(
        parseDesignRequest('script', { script: 'history', root, designRel: 'a.vetd', payload })
      ).toBeNull();
    expect(
      parseDesignRequest('script', {
        script: 'history',
        root,
        designRel: 'a.vetd',
        payload: { cmd: 'pack', out: '/tmp/evil' },
      })
    ).toEqual({ script: 'history', root, designRel: 'a.vetd', payload: { cmd: 'pack' } });
  });
  it('不支持 JSON 的网络 body 返回 null 而非抛异常', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      parseDesignRequest('network', {
        url: 'https://api.openverse.org/',
        body: { type: 'json', value: cyclic },
      })
    ).toBeNull();
    expect(
      parseDesignRequest('network', {
        url: 'https://api.openverse.org/',
        body: { type: 'json', value: 1n },
      })
    ).toBeNull();
  });
});
