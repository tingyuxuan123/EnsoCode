import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MentionSearchGroups } from '@/hooks/useMentionSearch';
import { MentionPicker } from './MentionPicker';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'zh-CN' }) }));

const baseGroups: MentionSearchGroups = {
  agents: [
    {
      kind: 'agent-type',
      id: 'builtin:explore',
      typeKey: 'builtin:explore',
      label: 'Explore',
      displayName: 'Explore',
      description: 'Read-only codebase search',
      source: 'builtin',
      locked: false,
      canDisable: true,
      canEdit: false,
    },
  ],
  members: [
    {
      kind: 'agent-type',
      id: 'bot:alice',
      typeKey: 'bot:alice',
      label: 'Alice',
      displayName: 'Alice',
      description: 'Frontend specialist',
      source: 'bot',
      locked: true,
      canDisable: false,
      canEdit: false,
    },
  ],
  chats: [
    {
      kind: 'chat',
      id: 'c1',
      label: '你好',
      sessionFile: '/sessions/2026-11-20T03-15-41-355Z_01a1f6f3-e4ab.jsonl',
    },
  ],
  files: [
    { kind: 'file', id: '.pi/', label: '.pi', relativePath: '.pi/' },
    { kind: 'file', id: 'src/', label: 'src', relativePath: 'src/' },
    {
      kind: 'file',
      id: 'src/App.tsx',
      label: 'App.tsx',
      relativePath: 'src/renderer/App.tsx',
    },
  ],
};

function renderPicker(props: Partial<Parameters<typeof MentionPicker>[0]> = {}) {
  const html = renderToStaticMarkup(
    createElement(MentionPicker, {
      groups: baseGroups,
      query: '',
      activeIndex: 1,
      onActiveIndexChange: vi.fn(),
      openFolderId: 'chats',
      folderIndex: 0,
      onOpenFolderIdChange: vi.fn(),
      onFolderIndexChange: vi.fn(),
      onSelect: vi.fn(),
      ...props,
    })
  );
  return parseHTML(html).document;
}

describe('MentionPicker', () => {
  it('renders clean nested root folders, Material file icons, and omits redundant top-level labels/badges', () => {
    const doc = renderPicker();
    const picker = doc.querySelector('[data-slot="mention-picker"]');
    expect(picker).not.toBeNull();

    // 不再渲染冗余的 Folder / File / Chat 边框徽章与原始会话文件名
    expect(picker?.querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
    expect(picker?.textContent).not.toContain('2026-11-20T03-15-41-355Z');

    const rootList = doc.querySelector('#composer-mention-picker');
    const options = Array.from(rootList?.querySelectorAll('[role="option"]') ?? []);
    const piOption = options.find((el) => el.textContent?.includes('.pi'));
    expect(piOption).toBeDefined();
    // 顶级目录不重复显示 ".pi" 第二行，且使用 FileTypeIcon <img>
    expect(piOption?.querySelectorAll('[data-mention-sub]')).toHaveLength(0);
    expect(piOption?.querySelector('img')).not.toBeNull();

    const nestedOption = options.find((el) => el.textContent?.includes('App.tsx'));
    expect(nestedOption?.querySelector('[data-mention-sub]')?.textContent).toBe('src/renderer');
  });

  it('renders flyout header with count and human-readable chat metadata', () => {
    const chatMeta = new Map([
      [
        'c1',
        {
          createdAt: Date.now() - 3 * 3_600_000,
          projectName: 'ylzx-app',
          sameProject: false,
        },
      ],
    ]);
    const doc = renderPicker({ chatMeta });
    const flyout = doc.querySelector('[data-slot="mention-flyout"]');
    expect(flyout).not.toBeNull();
    expect(flyout?.textContent).toContain('Chats');
    expect(flyout?.textContent).toContain('你好');
    expect(flyout?.textContent).toContain('ylzx-app');
    expect(flyout?.textContent).not.toContain('01a1f6f3');
    expect(flyout?.querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
  });

  it('omits redundant Member badge inside members flyout while preserving Locked and flat agent pills', () => {
    const membersFlyoutDoc = renderPicker({ openFolderId: 'members', activeIndex: 1 });
    const flyout = membersFlyoutDoc.querySelector('[data-slot="mention-flyout"]');
    const badges = Array.from(flyout?.querySelectorAll('[data-slot="badge"]') ?? []).map(
      (b) => b.textContent
    );
    expect(badges).toEqual(['Locked']);

    const flatDoc = renderPicker({ query: 'e', openFolderId: null, activeIndex: 0 });
    const flatBadges = Array.from(flatDoc.querySelectorAll('[data-slot="badge"]')).map(
      (b) => b.textContent
    );
    expect(flatBadges).toEqual(['Built-in', 'Member', 'Locked']);
  });

  it('propagates maxHeight to both root and flyout scroll containers without clipping', () => {
    const doc = renderPicker({ maxHeight: 196 });
    const rootList = doc.querySelector('#composer-mention-picker');
    const flyout = doc.querySelector('[data-slot="mention-flyout"]');
    expect(rootList?.getAttribute('style')).toContain('max-height:196px');
    expect(flyout?.getAttribute('style')).toContain('max-height:196px');
  });
});
