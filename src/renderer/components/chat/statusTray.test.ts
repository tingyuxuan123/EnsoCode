import { describe, expect, it } from 'vitest';
import { hostLabel, trayPlace } from './statusTray';

describe('输入框下方的位置托盘', () => {
  it.each([
    ['darwin', { kind: 'local' as const, name: 'EnsoCode', path: '/code' }],
    ['win32', { kind: 'local' as const, name: 'EnsoCode', path: '/code' }],
    ['darwin', { kind: 'scratch' as const, name: 'Temporary chats', path: '/tmp' }],
  ])('%s 上跑本机项目时不占一行「这台 Mac」', (_platform, project) => {
    // 本机是常量，说了等于没说；只有远端才需要提示「代码不在这台机器上」。
    expect(hostLabel(project)).toBeNull();
    expect(hostLabel(undefined)).toBeNull();
  });

  it('SSH 项目显示连接名，回落到 user@host', () => {
    expect(hostLabel({ kind: 'ssh', sshConnectionName: 'Prod Box' })).toBe('Prod Box');
    expect(hostLabel({ kind: 'ssh', sshHost: 'root@10.0.0.2' })).toBe('root@10.0.0.2');
    expect(hostLabel({ kind: 'ssh', sshConnectionName: '  ', sshHost: 'box' })).toBe('box');
  });

  it('缺 kind 但带远端目标时仍按远端处理，不因历史数据丢掉提示', () => {
    expect(hostLabel({ sshHost: 'box' })).toBe('box');
  });

  it('临时会话不挂项目名，避免把承载目录当成项目', () => {
    expect(trayPlace({ kind: 'scratch', name: 'Temporary chats', path: '/tmp/x' })).toEqual({
      project: null,
      temporary: true,
    });
    expect(trayPlace({ kind: 'local', name: 'EnsoCode', path: '/code/EnsoCode' })).toEqual({
      project: 'EnsoCode',
      temporary: false,
    });
    expect(trayPlace(undefined)).toEqual({ project: null, temporary: false });
  });
});
