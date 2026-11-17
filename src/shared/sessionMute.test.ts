import { describe, expect, it } from 'vitest';
import {
  isSessionMutedInConversations,
  isSessionMutedInStore,
  sessionMuteRoot,
  sessionMuteRootId,
} from './sessionMute';

type Row = { muted?: unknown; parentId?: string };

const settings = (conversations: Record<string, Row | null | undefined>) => ({
  'enso-conversations': { state: { conversations } },
});

describe('sessionMuteRootId', () => {
  it('结构化兜底只去掉子会话后缀', () => {
    expect(sessionMuteRootId('parent')).toBe('parent');
    expect(sessionMuteRootId('parent::cw-bob')).toBe('parent');
    expect(sessionMuteRootId('')).toBe('');
  });
});

describe('sessionMuteRoot 按持久化 parentId 回溯', () => {
  it('记录声明了 parentId 时以记录为准，不拿 id 里的 :: 前缀当根', () => {
    const saved = settings({ victim: {}, real: {}, 'other::cw-a': { parentId: 'real' } });
    expect(sessionMuteRoot(saved, 'other::cw-a')).toBe('real');
    // 前缀指向的 victim 被静音，也不能让别的会话跟着静音
    expect(
      isSessionMutedInStore(
        settings({ victim: { muted: true }, real: {}, 'other::cw-a': { parentId: 'real' } }),
        'other::cw-a'
      )
    ).toBe(false);
  });

  it('多级子会话回溯到最顶层根', () => {
    const saved = settings({
      root: { muted: true },
      mid: { parentId: 'root' },
      leaf: { parentId: 'mid' },
    });
    expect(sessionMuteRoot(saved, 'leaf')).toBe('root');
    expect(isSessionMutedInStore(saved, 'leaf')).toBe(true);
  });

  it('父记录还没落盘时停在声明的 parentId，不退回字符串前缀', () => {
    expect(
      sessionMuteRoot(settings({ 'other::cw-a': { parentId: 'pending' } }), 'other::cw-a')
    ).toBe('pending');
  });

  it('自指与环形 parentId 不会死循环', () => {
    expect(sessionMuteRoot(settings({ a: { parentId: 'a', muted: true } }), 'a')).toBe('a');
    expect(sessionMuteRoot(settings({ a: { parentId: 'b' }, b: { parentId: 'a' } }), 'a')).toBe(
      'b'
    );
  });

  it('记录缺失时才退回结构化前缀', () => {
    expect(sessionMuteRoot(settings({}), 'parent::cw-bob')).toBe('parent');
    expect(sessionMuteRoot(undefined, 'parent::cw-bob')).toBe('parent');
  });
});

describe('isSessionMutedInStore', () => {
  it('只认根会话 muted === true，子会话跟随父会话', () => {
    const saved = settings({ parent: { muted: true }, other: {} });
    expect(isSessionMutedInStore(saved, 'parent')).toBe(true);
    expect(isSessionMutedInStore(saved, 'parent::cw-bob')).toBe(true);
    expect(isSessionMutedInStore(saved, 'other')).toBe(false);
    expect(isSessionMutedInStore(saved, 'missing')).toBe(false);
  });

  it('脏配置和未静音不当作静音', () => {
    expect(isSessionMutedInStore(undefined, 'parent')).toBe(false);
    expect(isSessionMutedInStore({}, 'parent')).toBe(false);
    expect(isSessionMutedInStore({ 'enso-conversations': { state: {} } }, 'a')).toBe(false);
    expect(
      isSessionMutedInStore({ 'enso-conversations': { state: { conversations: [] } } }, 'a')
    ).toBe(false);
    expect(isSessionMutedInStore(settings({ parent: { muted: false } }), 'parent')).toBe(false);
    expect(isSessionMutedInStore(settings({ parent: { muted: 'true' } }), 'parent')).toBe(false);
    expect(isSessionMutedInStore(settings({ parent: null }), 'parent')).toBe(false);
    expect(isSessionMutedInStore('', 'parent')).toBe(false);
    expect(isSessionMutedInStore(settings({ parent: { muted: true } }), '')).toBe(false);
  });
});

describe('isSessionMutedInConversations', () => {
  it('直接吃会话表：子会话与旁路跟随根会话的静音', () => {
    const conversations = {
      root: { muted: true },
      'root::cw-a': { parentId: 'root' },
      btw: { btwParentId: 'root' },
      other: {},
    };
    expect(isSessionMutedInConversations(conversations, 'root')).toBe(true);
    expect(isSessionMutedInConversations(conversations, 'root::cw-a')).toBe(true);
    expect(isSessionMutedInConversations(conversations, 'btw')).toBe(true);
    expect(isSessionMutedInConversations(conversations, 'other')).toBe(false);
  });

  it('只有根会话的 muted 生效，子会话自己的字段被忽略', () => {
    const conversations = {
      root: {},
      child: { parentId: 'root', muted: true },
      'other::cw-x': { parentId: 'root' },
    };
    expect(isSessionMutedInConversations(conversations, 'child')).toBe(false);
    expect(isSessionMutedInConversations(conversations, 'root')).toBe(false);
    expect(isSessionMutedInConversations(conversations, 'other::cw-x')).toBe(false);
  });

  it('多级链、脏输入与空会话表', () => {
    const conversations = {
      root: { muted: true },
      mid: { parentId: 'root' },
      leaf: { parentId: 'mid' },
    };
    expect(isSessionMutedInConversations(conversations, 'leaf')).toBe(true);
    expect(isSessionMutedInConversations(undefined, 'leaf')).toBe(false);
    expect(isSessionMutedInConversations('', 'leaf')).toBe(false);
    expect(isSessionMutedInConversations(conversations, '')).toBe(false);
    // 记录缺失才退回结构化前缀
    expect(isSessionMutedInConversations(conversations, 'root::cw-unknown')).toBe(true);
  });
});
