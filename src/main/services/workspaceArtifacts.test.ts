import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProjectedMessage } from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  artifactCandidates,
  artifactKind,
  resolveArtifactFile,
  resolveArtifacts,
  textPathCandidates,
} from './workspaceArtifacts';

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

describe('resolveArtifacts', () => {
  let base = '';
  let root = '';
  let outside = '';
  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), 'workspace-artifacts-')));
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
    const result = resolveArtifacts(
      root,
      [
        'docs/r.md',
        path.join(root, 'page.html'),
        '../outside/secret.txt',
        path.join(outside, 'secret.txt'),
        'escape/secret.txt',
        'missing.md',
        'docs',
        './docs/../docs/r.md',
      ],
      8
    );
    expect(result).toEqual([
      { rel: path.join('docs', 'r.md'), kind: 'markdown' },
      { rel: 'page.html', kind: 'html' },
    ]);
  });

  it('工作区内的符号链接按真实目标去重', () => {
    expect(resolveArtifacts(root, ['alias/r.md', 'docs/r.md'], 8).map((a) => a.rel)).toEqual([
      path.join('docs', 'r.md'),
    ]);
  });

  it('最多返回指定数量', () => {
    const names = Array.from({ length: 12 }, (_, i) => `f${i}.txt`);
    for (const name of names) writeFileSync(path.join(root, name), name);
    expect(resolveArtifacts(root, names, 8)).toHaveLength(8);
  });

  it('工作区根不存在时为空', () => {
    expect(resolveArtifacts(path.join(base, 'nope'), ['a.md'], 8)).toEqual([]);
  });

  it('resolveArtifactFile 只接受根内的相对路径', () => {
    expect(resolveArtifactFile(root, 'docs/r.md')).toBe(path.join(root, 'docs', 'r.md'));
    expect(resolveArtifactFile(root, '../outside/secret.txt')).toBeNull();
    expect(resolveArtifactFile(root, path.join(outside, 'secret.txt'))).toBeNull();
    expect(resolveArtifactFile(root, 'escape/secret.txt')).toBeNull();
    expect(resolveArtifactFile(root, 'docs')).toBeNull();
  });
});
