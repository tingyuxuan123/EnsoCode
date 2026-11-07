import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProjectedMessage } from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  artifactCandidates,
  artifactKind,
  isOpenableArtifact,
  parseArtifactTarget,
  resolveArtifactFile,
  resolveArtifacts,
  resolveDesignArtifacts,
  textPathCandidates,
  turnBounds,
  turnOfReply,
} from './artifacts';

const { leafLinks } = vi.hoisted(() => ({ leafLinks: new Map<string, string>() }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    realpathSync: new Proxy(fs.realpathSync, {
      apply(target, receiver, args) {
        if (typeof args[0] === 'string') args[0] = leafLinks.get(args[0]) ?? args[0];
        return Reflect.apply(target, receiver, args);
      },
    }),
  };
});
// Manifest leaf links exercise bundle-local authority, not just workspace containment.
const leafLink = (target: string, alias: string) => {
  if (process.platform === 'win32') {
    linkSync(target, alias);
    leafLinks.set(alias, target);
  } else {
    symlinkSync(target, alias);
  }
};
afterEach(() => leafLinks.clear());

const text = (role: string, value: string): ProjectedMessage => ({
  role,
  content: [{ type: 'text', text: value }],
});
const call = (name: string, args: Record<string, unknown>): ProjectedMessage => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id: `${name}-1`, name, arguments: args }],
});

describe('textPathCandidates', () => {
  it('提取绝对路径、相对路径与带扩展名的文件名', () => {
    expect(
      textPathCandidates(
        '写好了 `docs/report.md` 和 /tmp/x/index.html，另见 notes.txt。代码在 src/app.ts:12:3'
      )
    ).toEqual(['docs/report.md', '/tmp/x/index.html', 'notes.txt', 'src/app.ts']);
  });
  it('markdown 链接与 file:// 取路径，网址忽略', () => {
    expect(
      textPathCandidates(
        '[报告](./out/r.md) 见 https://example.com/a.html 和 file:///Users/me/w/a.png'
      )
    ).toEqual(['./out/r.md', '/Users/me/w/a.png']);
  });
  it('普通单词、版本号之外的无扩展名单词不算', () => {
    expect(textPathCandidates('hello world, done!')).toEqual([]);
  });
  it('标准 file URL 还原本机路径，保留编码空格和中文而不拆成多个候选', () => {
    const file = path.join(tmpdir(), 'enso qa', '首页 图.png');
    expect(textPathCandidates(`[首页](${pathToFileURL(file).href})`)).toEqual([file]);
  });
  it('拒绝带凭证或编码路径分隔符的 file URL，不把非法 URL 当相对路径', () => {
    expect(
      textPathCandidates('file://user:secret@localhost/hidden.png file:///tmp/a%2Fb.png')
    ).toEqual([]);
  });
});

describe('artifactCandidates', () => {
  it('写文件类工具路径在前，正文路径在后，去重', () => {
    const messages: ProjectedMessage[] = [
      call('write', { path: 'a.md', content: 'x' }),
      call('edit', { path: '/w/b.ts' }),
      call('read', { path: 'ignored.md' }),
      {
        role: 'toolResult',
        toolName: 'apply_patch',
        content: [],
        fileChanges: [
          { path: 'c.html', oldText: '', newText: 'x', type: 'add' },
          { path: 'gone.md', oldText: 'x', newText: '', type: 'delete' },
        ],
      },
      text('assistant', '完成：a.md 与 d.png'),
    ];
    expect(artifactCandidates(messages)).toEqual(['a.md', '/w/b.ts', 'c.html', 'd.png']);
  });
});

describe('turnBounds / turnOfReply', () => {
  const messages = [
    text('user', 'q1'),
    text('assistant', 'a1'),
    text('user', 'q2'),
    call('write', { path: 'x.md' }),
    text('toolResult', 'ok'),
    text('assistant', 'done x.md'),
    text('user', 'q3'),
  ];
  it('按助手消息下标取所在轮（两条用户消息之间）', () => {
    expect(turnBounds(messages, 5)).toEqual({ start: 3, end: 6 });
    expect(turnBounds(messages, 1)).toEqual({ start: 1, end: 2 });
    expect(turnBounds(messages, 2)).toBeNull();
    expect(turnBounds(messages, 99)).toBeNull();
  });
  it('按最终回复文本定位最近一轮，找不到返回 null', () => {
    expect(turnOfReply(messages, ' done x.md ')).toEqual({ start: 3, end: 6 });
    expect(turnOfReply(messages, 'nope')).toBeNull();
  });
  it('按群条目时间排除后来同文的回复，缺少时间无法区分时不猜', () => {
    const repeated = [
      text('user', 'q1'),
      { ...text('assistant', 'done'), timestamp: 10 },
      text('user', 'q2'),
      { ...text('assistant', 'done'), timestamp: 30 },
    ];
    expect(turnOfReply(repeated, 'done', 20)).toEqual({ start: 1, end: 2 });
    expect(turnOfReply(repeated, 'done', 40)).toEqual({ start: 3, end: 4 });
    expect(
      turnOfReply([...repeated.slice(0, 3), text('assistant', 'done')], 'done', 40)
    ).toBeNull();
  });
});

describe('artifactKind', () => {
  it('按扩展名分类', () => {
    expect(artifactKind('a.PNG')).toBe('image');
    expect(artifactKind('a.md')).toBe('markdown');
    expect(artifactKind('a.htm')).toBe('html');
    expect(artifactKind('a.pdf')).toBe('pdf');
    expect(artifactKind('a.ts')).toBe('text');
    expect(artifactKind('a.zip')).toBe('other');
    expect(artifactKind('Makefile')).toBe('other');
  });
});

describe('parseArtifactTarget', () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  it('群条目或私聊会话 + 消息下标', () => {
    expect(parseArtifactTarget({ chatId, entryId: 'e1', extra: 1 })).toEqual({
      chatId,
      entryId: 'e1',
    });
    expect(parseArtifactTarget({ chatId, conversationId: 'c', messageIndex: 3 })).toEqual({
      chatId,
      conversationId: 'c',
      messageIndex: 3,
    });
  });
  it('拒绝坏入参与路径类字段', () => {
    for (const bad of [
      null,
      [],
      { chatId: 'x', entryId: 'e1' },
      { chatId },
      { chatId, entryId: '' },
      { chatId, entryId: 'e'.repeat(201) },
      { chatId, conversationId: 'c' },
      { chatId, conversationId: 'c', messageIndex: -1 },
      { chatId, conversationId: 'c', messageIndex: 1.5 },
      { chatId, conversationId: '', messageIndex: 1 },
    ]) {
      expect(parseArtifactTarget(bad)).toBeNull();
    }
  });
});

describe('isOpenableArtifact', () => {
  it('可执行与脚本类文件不交给默认应用', () => {
    expect(isOpenableArtifact('a.md', 0o644)).toBe(true);
    expect(isOpenableArtifact('a.png', 0o644)).toBe(true);
    expect(isOpenableArtifact('run.sh', 0o644)).toBe(false);
    expect(isOpenableArtifact('x.command', 0o644)).toBe(false);
    expect(isOpenableArtifact('tool.py', 0o644)).toBe(false);
    expect(isOpenableArtifact('a.txt', 0o755)).toBe(false);
  });
});

describe('resolveArtifacts', () => {
  let base = '';
  let root = '';
  let outside = '';
  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), 'bot-artifacts-')));
    root = path.join(base, 'ws');
    outside = path.join(base, 'outside');
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(root, 'docs', 'r.md'), '# hi');
    writeFileSync(path.join(root, 'page.html'), '<p>x</p>');
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, path.join(root, 'escape'), 'junction');
    symlinkSync(path.join(root, 'docs'), path.join(root, 'alias'), 'junction');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('只保留存在且位于工作区根内的普通文件', () => {
    const result = resolveArtifacts(root, [
      'docs/r.md',
      path.join(root, 'page.html'),
      '../outside/secret.txt',
      path.join(outside, 'secret.txt'),
      'escape/secret.txt',
      'missing.md',
      'docs',
      './docs/../docs/r.md',
    ]);
    expect(result).toEqual([
      { rel: path.join('docs', 'r.md'), name: 'r.md', size: 4, kind: 'markdown' },
      { rel: 'page.html', name: 'page.html', size: 8, kind: 'html' },
    ]);
  });

  it('工作区内的符号链接按真实目标去重', () => {
    expect(resolveArtifacts(root, ['alias/r.md', 'docs/r.md']).map((a) => a.rel)).toEqual([
      path.join('docs', 'r.md'),
    ]);
  });

  it('每条最多 8 张', () => {
    const names = Array.from({ length: 12 }, (_, i) => `f${i}.txt`);
    for (const name of names) writeFileSync(path.join(root, name), name);
    expect(resolveArtifacts(root, names)).toHaveLength(8);
  });

  it('工作区根不存在时为空', () => {
    expect(resolveArtifacts(path.join(base, 'nope'), ['a.md'])).toEqual([]);
  });

  it('resolveArtifactFile 只接受根内的相对路径', () => {
    expect(resolveArtifactFile(root, 'docs/r.md')).toBe(path.join(root, 'docs', 'r.md'));
    expect(resolveArtifactFile(root, '../outside/secret.txt')).toBeNull();
    expect(resolveArtifactFile(root, path.join(outside, 'secret.txt'))).toBeNull();
    expect(resolveArtifactFile(root, 'escape/secret.txt')).toBeNull();
    expect(resolveArtifactFile(root, 'docs')).toBeNull();
  });
});

describe('resolveDesignArtifacts', () => {
  let base = '';
  let root = '';
  const bundle = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'design.json'), '{}');
  };
  const create = (value: unknown, isError = false): ProjectedMessage => ({
    ...text('toolResult', JSON.stringify(value)),
    toolName: 'vetd_create',
    isError,
  });
  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), 'bot-designs-')));
    root = path.join(base, 'ws');
    mkdirSync(root);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('只从本轮路径、创建结果与投影设计卡片发现设计，以真实目录去重', () => {
    for (const name of ['write', 'create', 'created design', 'card', 'unmentioned']) {
      bundle(path.join(root, `${name}.vetd`));
    }
    symlinkSync(path.join(root, 'write.vetd'), path.join(root, 'alias.vetd'), 'junction');
    const messages: ProjectedMessage[] = [
      call('write', { path: 'alias.vetd/design.json' }),
      create({ ok: true, vetdPath: path.join(root, 'create.vetd') }),
      create({ ok: false, created: true, vetdPath: 'created design.vetd' }),
      {
        role: 'toolResult',
        toolName: 'vetd_screenshot',
        content: [],
        designCards: [
          { type: 'screenshot', key: 'a', title: 'A', payload: { vetdPath: 'card.vetd' } },
        ],
      },
      text('assistant', '交稿 `write.vetd`'),
    ];
    expect(resolveDesignArtifacts(root, artifactCandidates(messages), messages, 'session')).toEqual(
      ['write', 'create', 'created design', 'card'].map((name) => ({
        rel: `${name}.vetd`,
        name: `${name}.vetd`,
        sessionId: 'session',
      }))
    );
  });

  it('拒绝越界路径、非设计目录、无效 manifest 和失败或畸形的工具结果', () => {
    bundle(path.join(base, 'outside.vetd'));
    symlinkSync(path.join(base, 'outside.vetd'), path.join(root, 'escaped.vetd'), 'junction');
    mkdirSync(path.join(root, 'link.vetd'));
    leafLink(
      path.join(base, 'outside.vetd', 'design.json'),
      path.join(root, 'link.vetd/design.json')
    );
    mkdirSync(path.join(root, 'folder.vetd/design.json'), { recursive: true });
    mkdirSync(path.join(root, 'empty.vetd'));
    writeFileSync(path.join(root, 'file.vetd'), '{}');
    bundle(path.join(root, 'valid.vetd'));
    symlinkSync(path.join(root, 'valid.vetd'), path.join(base, 'outside-alias.vetd'), 'junction');
    mkdirSync(path.join(root, 'copied.vetd'));
    leafLink(path.join(root, 'valid.vetd/design.json'), path.join(root, 'copied.vetd/design.json'));
    leafLink(
      path.join(base, 'outside.vetd', 'design.json'),
      path.join(root, 'valid.vetd/out.json')
    );
    const messages: ProjectedMessage[] = [
      create({ ok: false, vetdPath: 'valid.vetd' }),
      create({ ok: true, vetdPath: 'valid.vetd' }, true),
      create({ ok: true, vetdPath: ['valid.vetd'] }),
      { ...text('toolResult', '{invalid json'), toolName: 'vetd_create' },
      { ...create({ ok: true, vetdPath: 'valid.vetd' }), toolName: 'read' },
    ];
    expect(
      resolveDesignArtifacts(
        root,
        [
          '../outside.vetd',
          'escaped.vetd',
          'link.vetd',
          'folder.vetd',
          'empty.vetd',
          'file.vetd',
          'valid.vetd/out.json',
          '../outside-alias.vetd',
          'copied.vetd',
        ],
        messages,
        'session'
      )
    ).toEqual([]);
  });

  it('每轮最多 8 张设计卡片，工作区根不存在时为空', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => `design-${i}.vetd`);
    for (const name of candidates) bundle(path.join(root, name));
    expect(resolveDesignArtifacts(root, candidates, [], 'session').map((item) => item.rel)).toEqual(
      candidates.slice(0, 8)
    );
    expect(resolveDesignArtifacts(path.join(base, 'missing'), candidates, [], 'session')).toEqual(
      []
    );
  });
});
