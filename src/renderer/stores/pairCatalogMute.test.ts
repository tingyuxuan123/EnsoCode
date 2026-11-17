import { describe, expect, it } from 'vitest';
import { attentionBadgeCount } from '../../../packages/phone/src/attentionBadge';
import { pairCatalogMuted } from './pairCatalogMute';

type Row = { parentId?: string; btwParentId?: string; muted?: boolean };

/** 与 pairCatalog.toEntry 同口径的目录条目投影（只投影静音与角标相关字段） */
const project = (
  conversations: Record<string, Row>,
  id: string,
  pending: { pendingAskCount?: number; pendingApprovalCount?: number } = {}
) => ({
  id,
  ...(pairCatalogMuted(conversations, id) ? { muted: true } : {}),
  ...pending,
});

const tree = (rootMuted: boolean): Record<string, Row> => ({
  root: rootMuted ? { muted: true } : {},
  'root::cw-scout': { parentId: 'root' },
  btw: { btwParentId: 'root' },
  other: {},
});

describe('配对目录静音投影', () => {
  it('静音根会话：子会话与旁路条目也标静音，手机角标不计它们的待审批/提问', () => {
    const conversations = tree(true);
    const child = project(conversations, 'root::cw-scout', {
      pendingAskCount: 1,
      pendingApprovalCount: 1,
    });
    const btw = project(conversations, 'btw', { pendingApprovalCount: 1 });
    const other = project(conversations, 'other', { pendingApprovalCount: 1 });
    expect(child.muted).toBe(true);
    expect(btw.muted).toBe(true);
    expect(other.muted).toBeUndefined();
    expect(attentionBadgeCount([child, btw, other])).toBe(1);
  });

  it('取消静音后子会话重新计入角标', () => {
    const muted = project(tree(true), 'root::cw-scout', { pendingAskCount: 2 });
    const unmuted = project(tree(false), 'root::cw-scout', { pendingAskCount: 2 });
    expect(attentionBadgeCount([muted])).toBe(0);
    expect(attentionBadgeCount([unmuted])).toBe(2);
  });

  it('静音只加标记：子会话条目照常带着待审批/提问下发，正文与事件不被过滤', () => {
    const child = project(tree(true), 'root::cw-scout', {
      pendingAskCount: 2,
      pendingApprovalCount: 3,
    });
    expect(child).toEqual({
      id: 'root::cw-scout',
      muted: true,
      pendingAskCount: 2,
      pendingApprovalCount: 3,
    });
  });

  it('只有根会话的 muted 生效，子会话自己的字段被忽略', () => {
    const conversations: Record<string, Row> = {
      root: {},
      child: { parentId: 'root', muted: true },
    };
    expect(pairCatalogMuted(conversations, 'root')).toBe(false);
    expect(pairCatalogMuted(conversations, 'child')).toBe(false);
    // 有持久化 parentId 时前缀不能当权威父会话
    const spoofed: Record<string, Row> = {
      victim: { muted: true },
      real: {},
      'victim::cw-x': { parentId: 'real' },
    };
    expect(pairCatalogMuted(spoofed, 'victim::cw-x')).toBe(false);
  });
});
