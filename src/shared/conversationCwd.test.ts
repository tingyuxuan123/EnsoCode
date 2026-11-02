import { describe, expect, it } from 'vitest';
import { conversationCwd } from './conversationCwd';

const id = '11111111-1111-4111-8111-111111111111';

describe('conversationCwd', () => {
  it('scratch 每会话独立，忽略 worktree，不依赖 Node 路径模块', () => {
    expect(
      conversationCwd({
        kind: 'scratch',
        canonicalPath: '/data/scratch/',
        conversationId: id,
        worktreePath: '/wrong',
      })
    ).toBe(`/data/scratch/${id}`);
    expect(
      conversationCwd({ kind: 'scratch', canonicalPath: 'C:\\Data\\scratch\\', conversationId: id })
    ).toBe(`C:\\Data\\scratch\\${id}`);
  });

  it.each(['', '..', '../other', `${id}/../other`, `${id}::cw-child`])(
    'scratch 拒绝非法会话 id %s',
    (conversationId) => {
      expect(
        conversationCwd({ kind: 'scratch', canonicalPath: '/data/scratch', conversationId })
      ).toBeNull();
    }
  );

  it('scratch 缺根目录拒绝，普通、SSH 与 worktree 路径原样保留', () => {
    expect(conversationCwd({ kind: 'scratch', canonicalPath: '', conversationId: id })).toBeNull();
    expect(conversationCwd({ canonicalPath: '/repo/', conversationId: '' })).toBe('/repo/');
    expect(
      conversationCwd({ canonicalPath: '/repo', conversationId: id, worktreePath: '/wt' })
    ).toBe('/wt');
    expect(
      conversationCwd({
        kind: 'ssh',
        canonicalPath: '/remote',
        conversationId: id,
        worktreePath: '/wt',
      })
    ).toBe('/remote');
  });
});
