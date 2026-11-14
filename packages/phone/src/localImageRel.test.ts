import { describe, expect, it } from 'vitest';
import { toWorkspaceRelPath } from './localImageRel';

describe('toWorkspaceRelPath', () => {
  it('把会话目录内的绝对路径换成相对路径', () => {
    expect(toWorkspaceRelPath('/work/proj/shots/a.png', '/work/proj')).toBe('shots/a.png');
    expect(toWorkspaceRelPath('/work/proj/.xiaoman/images/a.png', '/work/proj/')).toBe(
      '.xiaoman/images/a.png'
    );
    expect(toWorkspaceRelPath('C:\\work\\proj\\a.png', 'C:/work/proj')).toBe('a.png');
  });

  it('目录外、UNC、根自身与脏输入都返回 null（手机不上传磁盘路径）', () => {
    expect(toWorkspaceRelPath('/etc/passwd', '/work/proj')).toBeNull();
    expect(toWorkspaceRelPath('/work/proj2/a.png', '/work/proj')).toBeNull();
    expect(toWorkspaceRelPath('/work/proj', '/work/proj')).toBeNull();
    expect(toWorkspaceRelPath('//server/share/a.png', '//server/share')).toBeNull();
    expect(toWorkspaceRelPath('a.png', '/work/proj')).toBeNull();
    expect(toWorkspaceRelPath('/work/proj/a.png', undefined)).toBeNull();
    expect(toWorkspaceRelPath('D:/work/a.png', 'C:/work')).toBeNull();
    expect(toWorkspaceRelPath('/work/proj/a/../b.png', '/work/proj')).toBeNull();
  });
});
