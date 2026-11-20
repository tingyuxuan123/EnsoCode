import { describe, expect, it } from 'vitest';
import {
  extractWikiLinks,
  makeNoteId,
  normalizeNoteSlug,
  normalizeNoteType,
  parseMarkdownNote,
  parseNoteId,
  patchMarkdownSection,
  resolveSafeRelPath,
  resolveWikiLinkTarget,
  serializeMarkdownNote,
} from './markdown';

describe('OKF v0.2 markdown frontmatter parser & serializer', () => {
  it('parses full OKF v0.2 frontmatter and preserves unknown Obsidian fields', () => {
    const raw = [
      '---',
      'type: incident',
      'title: Preload 外部化故障',
      'description: preload 改动后启动崩溃的根因与防线',
      'status: verified',
      'tags:',
      '  - preload',
      '  - electron',
      'resource: src/preload/index.ts',
      'generated:',
      '  by: collabra-agent',
      '  at: 2026-11-20T12:00:00Z',
      'verified:',
      '  by: user',
      '  at: 2026-11-20T13:00:00Z',
      'stale_after: 2027-05-20',
      'sources:',
      '  - session:conv_1',
      '  - code:src/preload/index.ts',
      'cssclasses:',
      '  - wide-page',
      'custom_owner: backend-team',
      '---',
      '',
      '# Preload 外部化故障',
      '',
      '参考 [[systems/electron-build|构建链路]] 与 [[practices/ipc-boundaries#校验]]。',
    ].join('\n');

    const parsed = parseMarkdownNote(raw, 'preload-issue');
    expect(parsed.frontmatter.type).toBe('incident');
    expect(parsed.frontmatter.title).toBe('Preload 外部化故障');
    expect(parsed.frontmatter.description).toBe('preload 改动后启动崩溃的根因与防线');
    expect(parsed.frontmatter.status).toBe('verified');
    expect(parsed.frontmatter.tags).toEqual(['preload', 'electron']);
    expect(parsed.frontmatter.resource).toBe('src/preload/index.ts');
    expect(parsed.frontmatter.generated).toEqual({
      by: 'collabra-agent',
      at: '2026-11-20T12:00:00Z',
    });
    expect(parsed.frontmatter.verified).toEqual({
      by: 'user',
      at: '2026-11-20T13:00:00Z',
    });
    expect(parsed.frontmatter.stale_after).toBe('2027-05-20');
    expect(parsed.frontmatter.sources).toEqual(['session:conv_1', 'code:src/preload/index.ts']);
    expect(parsed.frontmatter.extra).toEqual({
      cssclasses: ['wide-page'],
      custom_owner: 'backend-team',
    });

    const roundTrip = serializeMarkdownNote(parsed.frontmatter, parsed.body);
    const reparsed = parseMarkdownNote(roundTrip, 'preload-issue');
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.body).toBe(parsed.body);
  });

  it('tolerates external Obsidian markdown without frontmatter and derives title from H1 or filename', () => {
    const withH1 = '# 支付回调幂等\n\n使用唯一键防重。';
    const parsed1 = parseMarkdownNote(withH1, 'payment-idempotency');
    expect(parsed1.frontmatter.type).toBe('note');
    expect(parsed1.frontmatter.title).toBe('支付回调幂等');
    expect(parsed1.frontmatter.status).toBe('verified');
    expect(parsed1.frontmatter.tags).toEqual([]);
    expect(parsed1.body).toBe('# 支付回调幂等\n\n使用唯一键防重。');

    const plain = '只是一段普通笔记。';
    const parsed2 = parseMarkdownNote(plain, 'quick-thought');
    expect(parsed2.frontmatter.title).toBe('quick-thought');
    expect(parsed2.frontmatter.type).toBe('note');
  });

  it('survives malformed YAML frontmatter without throwing', () => {
    const broken = '---\ntype: [unclosed\ntitle: broken: : yaml\n---\n正文仍在。';
    const parsed = parseMarkdownNote(broken, 'fallback-name');
    expect(parsed.frontmatter.type).toBe('note');
    expect(parsed.frontmatter.title).toBe('fallback-name');
    expect(parsed.body).toBe('正文仍在。');
  });

  it('handles CRLF line endings cleanly', () => {
    const crlf =
      '---\r\ntype: decision\r\ntitle: Use Markdown\r\n---\r\n\r\nBody line 1\r\nBody line 2\r\n';
    const parsed = parseMarkdownNote(crlf, 'use-md');
    expect(parsed.frontmatter.type).toBe('decision');
    expect(parsed.frontmatter.title).toBe('Use Markdown');
    expect(parsed.body).toBe('Body line 1\nBody line 2');
  });
});

describe('wikilink extraction and resolution', () => {
  it('extracts wikilinks with aliases and headings while ignoring code blocks and embeds', () => {
    const md = [
      '正常链接 [[systems/auth]] 和 [[incidents/oauth-refresh|OAuth 刷新]]。',
      '带锚点 [[practices/tdd#Red-Green|红绿循环]]，重复 [[systems/auth]]。',
      '忽略嵌入图片 ![[diagram.png]] 与行内代码 `[[not-a-link]]`。',
      '```markdown',
      '[[inside-fenced-code]]',
      '```',
      '~~~ts',
      'const x = "[[inside-tilde-fence]]";',
      '~~~',
      '结尾链接 [[中文笔记]]。',
    ].join('\n');

    const links = extractWikiLinks(md);
    expect(links).toEqual([
      { raw: '[[systems/auth]]', target: 'systems/auth', heading: null, alias: null },
      {
        raw: '[[incidents/oauth-refresh|OAuth 刷新]]',
        target: 'incidents/oauth-refresh',
        heading: null,
        alias: 'OAuth 刷新',
      },
      {
        raw: '[[practices/tdd#Red-Green|红绿循环]]',
        target: 'practices/tdd',
        heading: 'Red-Green',
        alias: '红绿循环',
      },
      { raw: '[[中文笔记]]', target: '中文笔记', heading: null, alias: null },
    ]);
  });

  it('resolves wikilink targets by path, slug, basename, or title', () => {
    const entries = [
      { relPath: 'wiki/systems/auth.md', slug: 'systems/auth', title: '认证体系' },
      {
        relPath: 'wiki/incidents/oauth-refresh.md',
        slug: 'incidents/oauth-refresh',
        title: 'OAuth 刷新事故',
      },
      { relPath: 'notes/standalone.md', slug: 'standalone', title: '独立笔记' },
    ];

    expect(resolveWikiLinkTarget('wiki/systems/auth.md', entries)).toBe('wiki/systems/auth.md');
    expect(resolveWikiLinkTarget('systems/auth', entries)).toBe('wiki/systems/auth.md');
    expect(resolveWikiLinkTarget('oauth-refresh', entries)).toBe('wiki/incidents/oauth-refresh.md');
    expect(resolveWikiLinkTarget('认证体系', entries)).toBe('wiki/systems/auth.md');
    expect(resolveWikiLinkTarget('STANDALONE', entries)).toBe('notes/standalone.md');
    expect(resolveWikiLinkTarget('non-existent', entries)).toBeNull();
  });
});

describe('section patching', () => {
  it('replaces an existing section without clobbering siblings or nested headings', () => {
    const body = [
      '# 认证体系',
      '',
      '## 架构',
      '旧架构说明',
      '### 子模块',
      '旧子模块',
      '',
      '## 已知坑点',
      '保留坑点内容',
    ].join('\n');

    const patched = patchMarkdownSection(body, '架构', '新架构说明\n\n### 新子模块\n细节');
    expect(patched).toContain('## 架构\n\n新架构说明\n\n### 新子模块\n细节');
    expect(patched).toContain('## 已知坑点\n保留坑点内容');
    expect(patched).not.toContain('旧架构说明');
    expect(patched).not.toContain('旧子模块');
  });

  it('appends a new H2 section when the heading does not exist', () => {
    const body = '# 认证体系\n\n概览。';
    const patched = patchMarkdownSection(body, '演进记录', '- 2026-11-20 切换到 PKCE');
    expect(patched).toBe('# 认证体系\n\n概览。\n\n## 演进记录\n\n- 2026-11-20 切换到 PKCE');
  });

  it('ignores headings inside fenced code blocks', () => {
    const body = '```md\n## 架构\n示例代码\n```\n\n## 架构\n真实正文';
    const patched = patchMarkdownSection(body, '架构', '更新后的真实正文');
    expect(patched).toContain('```md\n## 架构\n示例代码\n```');
    expect(patched).toContain('## 架构\n\n更新后的真实正文');
    expect(patched).not.toContain('真实正文\n');
  });
});

describe('path, slug, type and noteId safety boundaries', () => {
  it('normalizes slugs preserving unicode while stripping unsafe characters', () => {
    expect(normalizeNoteSlug('OAuth Refresh 故障 / 处理')).toBe('oauth-refresh-故障-处理');
    expect(normalizeNoteSlug('  ../evil\\path:name?.md ')).toBe('evil-path-name');
    expect(normalizeNoteSlug('***')).toBe('untitled');
  });

  it('normalizes open-vocabulary note types safely', () => {
    expect(normalizeNoteType('  System Architecture ')).toBe('system-architecture');
    expect(normalizeNoteType('incidents')).toBe('incidents');
    expect(normalizeNoteType('')).toBe('note');
    expect(normalizeNoteType('../evil')).toBe('evil');
  });

  it('rejects traversal, hidden directories, and reserved paths in resolveSafeRelPath', () => {
    expect(resolveSafeRelPath('wiki/systems/auth')).toBe('wiki/systems/auth.md');
    expect(resolveSafeRelPath('wiki\\systems\\auth.md')).toBe('wiki/systems/auth.md');
    expect(resolveSafeRelPath('/wiki/notes/a.md')).toBe('wiki/notes/a.md');
    expect(resolveSafeRelPath('../secret.md')).toBeNull();
    expect(resolveSafeRelPath('wiki/../../secret.md')).toBeNull();
    expect(resolveSafeRelPath('.obsidian/app.json')).toBeNull();
    expect(resolveSafeRelPath('wiki/.hidden/a.md')).toBeNull();
    expect(resolveSafeRelPath('node_modules/pkg/readme.md')).toBeNull();
    expect(resolveSafeRelPath('')).toBeNull();
  });

  it('round-trips canonical note IDs and rejects malformed IDs', () => {
    const id = makeNoteId('proj:abc-123', 'wiki/systems/auth.md');
    expect(id).toBe('proj:abc-123::wiki/systems/auth.md');
    expect(parseNoteId(id)).toEqual({
      spaceId: 'proj:abc-123',
      relPath: 'wiki/systems/auth.md',
    });
    expect(parseNoteId('proj:abc-123::../escape.md')).toBeNull();
    expect(parseNoteId('no-separator')).toBeNull();
  });
});
