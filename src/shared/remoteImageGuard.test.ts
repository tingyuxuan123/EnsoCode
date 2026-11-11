import { describe, expect, it } from 'vitest';
import { isAllowedRemoteImageUrl, isPrivateOrReservedIp } from './remoteImageGuard';

describe('isPrivateOrReservedIp', () => {
  it('IPv4 内网/环回/链路本地/CGNAT 段视为私有', () => {
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true); // 云元数据端点
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
  });

  it('公网 IPv4 不算私有', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false);
  });

  it('IPv6 环回/链路本地/唯一本地/IPv4 映射视为私有', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('fd12:3456::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('公网 IPv6 不算私有', () => {
    expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
  });
  it('IPv6 压缩/展开/十六进制映射不能绕过私有地址规则', () => {
    for (const ip of [
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:a9fe:a9fe',
      '0:0:0:0:0:0:0:1',
      'febf::1',
      'ff02::1',
    ])
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    expect(isAllowedRemoteImageUrl('http://[::ffff:7f00:1]/x.png')).toBe(false);
    expect(isPrivateOrReservedIp('::ffff:808:808')).toBe(false);
  });
});

describe('isAllowedRemoteImageUrl', () => {
  it('放行公网 http/https URL', () => {
    expect(isAllowedRemoteImageUrl('https://img.shields.io/badge.svg')).toBe(true);
    expect(isAllowedRemoteImageUrl('http://example.com/a.png')).toBe(true);
  });

  it('拒绝非 http/https 协议', () => {
    expect(isAllowedRemoteImageUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedRemoteImageUrl('ftp://example.com/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('javascript:alert(1)')).toBe(false);
  });

  it('拒绝 localhost / .local / 字面量内网 IP', () => {
    expect(isAllowedRemoteImageUrl('http://localhost/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://printer.local/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://192.168.1.1/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://[::1]/x.png')).toBe(false);
  });

  it('拒绝带用户名密码的 URL（防混淆内网跳转）', () => {
    expect(isAllowedRemoteImageUrl('http://user:pass@example.com/x.png')).toBe(false);
  });

  it('解析失败的字符串拒绝', () => {
    expect(isAllowedRemoteImageUrl('not a url')).toBe(false);
    expect(isAllowedRemoteImageUrl('')).toBe(false);
  });
});
