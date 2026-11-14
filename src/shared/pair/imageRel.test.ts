import { describe, expect, it } from 'vitest';
import { normalizeSessionImageRel } from './imageRel';

describe('normalizeSessionImageRel', () => {
  it('接受工作区内的相对路径并去掉多余的 ./ 与空段', () => {
    expect(normalizeSessionImageRel('shot.png')).toBe('shot.png');
    expect(normalizeSessionImageRel('./.xiaoman/images/a.png')).toBe('.xiaoman/images/a.png');
    expect(normalizeSessionImageRel('a//b.png')).toBe('a/b.png');
    expect(normalizeSessionImageRel('截图 1.png')).toBe('截图 1.png');
  });

  it('拒绝绝对路径、盘符、UNC、反斜杠、NUL 与 .. 段', () => {
    for (const bad of [
      '/etc/passwd',
      'C:/Windows/x.png',
      'c:x.png',
      '//server/share/a.png',
      'a\\b.png',
      'a\0b.png',
      '../outside.png',
      'a/../../outside.png',
      '',
      '.',
      './',
      null,
      42,
    ])
      expect(normalizeSessionImageRel(bad as unknown)).toBeNull();
  });

  it('拒绝超长路径', () => {
    expect(normalizeSessionImageRel('a'.repeat(5000))).toBeNull();
  });
});
