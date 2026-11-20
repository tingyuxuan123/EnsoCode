import { describe, expect, it } from 'vitest';
import {
  formatChatMentionMeta,
  mentionFileParentPath,
  parseSessionFileTimestamp,
} from './mentionPickerDisplay';

describe('mentionFileParentPath', () => {
  it('omits subtitle when top-level file or folder equals label', () => {
    expect(mentionFileParentPath('.pi', '.pi', '.pi/')).toBeUndefined();
    expect(mentionFileParentPath('src', 'src', 'src/')).toBeUndefined();
    expect(mentionFileParentPath('package.json', 'package.json', 'package.json')).toBeUndefined();
    expect(mentionFileParentPath('docs', undefined, 'docs/')).toBeUndefined();
  });

  it('strips trailing basename so only the parent directory path is shown', () => {
    expect(
      mentionFileParentPath(
        'MentionPicker.tsx',
        'src/renderer/components/chat/MentionPicker.tsx',
        'src/renderer/components/chat/MentionPicker.tsx'
      )
    ).toBe('src/renderer/components/chat');
    expect(
      mentionFileParentPath(
        'index.ts',
        '…/components/chat/index.ts',
        'src/renderer/components/chat/index.ts'
      )
    ).toBe('…/components/chat');
    expect(
      mentionFileParentPath('chat', '…/components/chat', 'src/renderer/components/chat/')
    ).toBe('…/components');
    expect(mentionFileParentPath('Button.tsx', undefined, 'src\\components\\Button.tsx')).toBe(
      'src/components'
    );
  });
});

describe('parseSessionFileTimestamp', () => {
  it('parses pi ISO-like timestamp prefix from session jsonl filenames', () => {
    expect(
      parseSessionFileTimestamp(
        '/Users/me/.pi/sessions/2026-11-20T03-15-41-355Z_01a1f6f3-e4ab.jsonl'
      )
    ).toBe(Date.parse('2026-11-20T03:15:41.355Z'));
    expect(parseSessionFileTimestamp('2026-11-20T03-15-41Z_abc.jsonl')).toBe(
      Date.parse('2026-11-20T03:15:41Z')
    );
    expect(parseSessionFileTimestamp('/s/c1.jsonl')).toBeUndefined();
  });
});

describe('formatChatMentionMeta', () => {
  const now = Date.parse('2026-11-20T06:15:41.355Z');

  it('prefers explicit chatMeta relative time and cross-project name', () => {
    const candidate = {
      kind: 'chat' as const,
      id: 'c1',
      label: '危链订单前端接口适配',
      sessionFile: '/s/2026-11-19T03-15-41-355Z_uuid.jsonl',
    };
    expect(
      formatChatMentionMeta({
        candidate,
        meta: { createdAt: now - 3 * 3_600_000, projectName: 'EnsoCode', sameProject: true },
        locale: 'zh-CN',
        now,
      })
    ).toBe('3小时前');

    expect(
      formatChatMentionMeta({
        candidate,
        meta: { createdAt: now - 24 * 3_600_000, projectName: 'ylzx-app', sameProject: false },
        locale: 'zh-CN',
        now,
      })
    ).toBe('ylzx-app · 昨天');
  });

  it('falls back to parsing timestamp from sessionFile and hides raw UUID filenames', () => {
    expect(
      formatChatMentionMeta({
        candidate: {
          kind: 'chat',
          id: 'c2',
          label: '你好',
          sessionFile: '/sessions/2026-11-20T03-15-41-355Z_01a1f6f3-e4ab.jsonl',
        },
        locale: 'zh-CN',
        now,
      })
    ).toBe('3小时前');

    expect(
      formatChatMentionMeta({
        candidate: {
          kind: 'chat',
          id: 'c3',
          label: 'fix login',
          sessionFile: '/s/c3.jsonl',
        },
        locale: 'zh-CN',
        now,
      })
    ).toBeUndefined();
  });
});
