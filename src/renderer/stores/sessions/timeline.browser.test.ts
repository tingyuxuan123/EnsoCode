import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { buildTimeline, foldTimeline, type TimelineItem } from './timeline';

const messages: ProjectedMessage[] = [
  { role: 'user', content: [{ type: 'text', text: '登录' }] },
  {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: 'n',
        name: 'browser_navigate',
        arguments: { url: 'https://example.com/login', description: '进入登录页' },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'n',
    toolName: 'browser_navigate',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tabId: 'tab-a',
          observation: 'Appeared: - textbox "密码" [ref=e1] [kind=fill]',
        }),
      },
    ],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: 'f',
        name: 'browser_fill',
        arguments: { tabId: 'tab-a', ref: 'e1', value: 'secret-password', description: '填写密码' },
      },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'f',
    toolName: 'browser_fill',
    content: [{ type: 'text', text: '{}' }],
  },
];

describe('browser activity timeline', () => {
  it('uses observed labels in old history without descriptions and scopes identical refs to their tab', () => {
    const old = structuredClone(messages);
    for (const message of old)
      if (message.role === 'assistant')
        for (const part of message.content)
          if (part.type === 'toolCall')
            delete (part.arguments as Record<string, unknown>).description;
    const rows = buildTimeline(old, false).filter((row) => row.kind === 'tool');
    expect(rows[1].browser?.label).toEqual({ key: 'Fill {{target}}', target: '密码' });
    const other: ProjectedMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'n2',
            name: 'browser_navigate',
            arguments: { url: 'https://example.com/search' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'n2',
        toolName: 'browser_navigate',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tabId: 'tab-b',
              observation: 'Appeared: - textbox "搜索" [ref=e1] [kind=fill]',
            }),
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'f2',
            name: 'browser_fill',
            arguments: { tabId: 'tab-a', ref: 'e1', value: 'secret' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'f2',
        toolName: 'browser_fill',
        content: [{ type: 'text', text: '{}' }],
      },
    ];
    const scoped = buildTimeline([...old, ...other], false).filter((row) => row.kind === 'tool');
    expect(scoped.at(-1)?.browser?.label).toEqual({ key: 'Fill {{target}}', target: '密码' });
  });
  it('builds business labels while preserving the authoritative raw tool output separately', () => {
    const rows = buildTimeline(messages, false).filter((row) => row.kind === 'tool');
    expect(rows[0].browser?.label).toEqual({ text: '进入登录页' });
    expect(rows[1].browser?.label).toEqual({ text: '填写密码' });
    expect(rows[0].output).toContain('tab-a');
    expect(JSON.stringify(rows.map((row) => row.browser))).not.toContain('secret-password');
  });

  it.each([false, true])(
    'groups live and historical browser steps independently of compact mode (%s)',
    (compact) => {
      const rows = buildTimeline(messages, false);
      for (const running of [false, true]) {
        const folded = foldTimeline(rows, running, new Set(), { compact });
        const group = folded.find((row) => row.kind === 'tool-group');
        expect(group?.kind).toBe('tool-group');
        if (group?.kind !== 'tool-group') throw new Error('missing group');
        expect(group.browser?.count).toBe(2);
        expect(group.children.filter((row) => row.kind === 'tool')).toHaveLength(2);
        const expanded = foldTimeline(rows, running, new Set([group.key]), { compact });
        expect(expanded.filter((row) => row.kind === 'tool' && row.nested)).toHaveLength(2);
      }
    }
  );

  it('counts real thinking duration, exposes failures collapsed, and does not swallow final answers', () => {
    const rows = buildTimeline(messages, false);
    rows.splice(2, 0, {
      kind: 'thinking',
      key: 'thinking',
      text: 'private reasoning',
      streaming: false,
      durationMs: 3000,
    });
    const failure = rows.findLast((row) => row.kind === 'tool');
    if (failure?.kind === 'tool') failure.state = 'error';
    const answer: TimelineItem = {
      kind: 'text',
      key: 'answer',
      text: '请重试登录',
      streaming: false,
    };
    const folded = foldTimeline([...rows, answer], false, new Set());
    const group = folded.find((row) => row.kind === 'tool-group');
    if (group?.kind !== 'tool-group') throw new Error('missing browser group');
    expect(group.browser).toMatchObject({ count: 2, thinkingMs: 3000, failed: 1 });
    expect(folded.at(-1)).toBe(answer);
  });

  it('warns collapsed when an action was delivered but the page could not be observed', () => {
    const copy = structuredClone(messages);
    const last = copy.at(-1)!;
    last.content = [
      {
        type: 'text',
        text: '{"actionCompleted":true,"observationError":"Page changed; verify before retrying"}',
      },
    ];
    const group = foldTimeline(buildTimeline(copy, false), false, new Set()).find(
      (row) => row.kind === 'tool-group'
    );
    if (group?.kind !== 'tool-group') throw new Error('missing group');
    expect(group.browser?.warnings).toBe(1);
    expect(group.browser?.failed).toBe(0);
  });
});
