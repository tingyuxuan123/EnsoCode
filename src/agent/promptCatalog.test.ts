import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  type CatalogTool,
  promptCatalogExtension,
  renderToolCatalogSection,
} from './promptCatalog';

const tool = (name: string, description: string, namespace?: string): CatalogTool => ({
  name,
  description,
  ...(namespace ? { namespace: { name: namespace, description: `${namespace} server` } } : {}),
});

describe('工具目录', () => {
  it('没有额外工具时不出段', () => {
    expect(renderToolCatalogSection([])).toBeUndefined();
  });

  it('按来源和工具名稳定分组，只保留多语言首句', () => {
    const tools = [
      tool('web_search', 'Search the web. Extra detail.'),
      tool('mcp__z__search', '搜索文档。不要保留第二句。', 'mcp__z'),
      tool('mcp__a__get', '取得页面！第二句。', 'mcp__a'),
      tool('mcp__a__find', 'Find docs? More detail.', 'mcp__a'),
    ];
    const section = renderToolCatalogSection(tools) ?? '';
    expect(section).toBe(renderToolCatalogSection([...tools].reverse()));
    expect(section).toContain('mcp__a — mcp__a server');
    expect(section).toContain('- mcp__z__search: 搜索文档。');
    expect(section).toContain('- mcp__a__get: 取得页面！');
    expect(section).toContain('- mcp__a__find: Find docs?');
    expect(section).not.toMatch(/第二句|Extra detail|More detail/);
    expect(section.indexOf('mcp__a__find')).toBeLessThan(section.indexOf('mcp__a__get'));
    expect(section.indexOf('mcp__a —')).toBeLessThan(section.indexOf('mcp__z —'));
    expect(section.indexOf('mcp__z —')).toBeLessThan(section.indexOf('built-in'));
  });

  it('单行有界并去掉控制字符，长名称和 namespace 不能突破总预算', () => {
    const tools = Array.from({ length: 200 }, (_, i) =>
      tool(
        `tool_${String(i).padStart(3, '0')}_${'n'.repeat(400)}`,
        'x\n\u202e'.repeat(400),
        `ns_${'z'.repeat(400)}`
      )
    );
    const section = renderToolCatalogSection(tools) ?? '';
    expect(section).toMatch(/\+\d+ more:/);
    expect(section.length).toBeLessThanOrEqual(7600);
    expect([...section].every((char) => char === '\n' || char.charCodeAt(0) >= 0x20)).toBe(true);
    expect(section).not.toContain('\u202e');
    expect(section.split('\n').every((line) => line.length <= 300)).toBe(true);
    expect(
      section
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .every((line) => line.length <= 160)
    ).toBe(true);
    expect(section).toBe(renderToolCatalogSection([...tools].reverse()));
    expect(section.split('\n').at(-1)).toMatch(/tool_/);
  });

  it('仅辅助发现，保留直接读取与语义搜索分流，不冒充 schema 或工具选型指南', () => {
    const section = renderToolCatalogSection([tool('web_search', 'Search web.')]) ?? '';
    expect(section).toContain('discovery');
    expect(section).toContain('schema');
    expect(section).toContain('guidelines');
    expect(section).toContain('known path → read');
    expect(section).toContain('exact symbol → grep');
    expect(section).toContain('unknown behavior → code_search');
    expect(section).not.toMatch(
      /rather than.*(?:bash|read|grep)|not list|not visible|not secondary/i
    );
  });
});

describe('promptCatalogExtension', () => {
  function setup(initial: CatalogTool[]) {
    let all = initial;
    let handler: ((event: BeforeAgentStartEvent) => unknown) | undefined;
    promptCatalogExtension.factory({
      on: (_name: string, fn: typeof handler) => {
        handler = fn;
      },
      getAllTools: () => all,
    } as unknown as ExtensionAPI);
    const options: BeforeAgentStartEvent['systemPromptOptions'] = {
      cwd: '/workspace',
      selectedTools: [],
      hiddenTools: [],
      toolSnippets: {},
      toolGuidelines: {},
      promptGuidelines: ['MODEL SELECTION GUIDE'],
      appendSystemPrompt: 'PRELUDE',
      sections: { security: 'SECURITY', browser: 'BROWSER', plan: 'PLAN', skills: 'FULL SKILLS' },
      contextFiles: [],
      skills: [],
    };
    return {
      options,
      tools: (next: CatalogTool[]) => {
        all = next;
      },
      run: () =>
        handler?.({
          type: 'before_agent_start',
          messageType: 'user',
          prompt: 'hi',
          systemPrompt: '',
          systemPromptOptions: options,
        }),
    };
  }

  it('只索引真实注册、已启用且无 snippet 的工具，不碰其他提示段或配置', () => {
    const fixture = setup([
      tool('read', 'Read file.'),
      tool('code_search', 'Search code.'),
      tool('mcp__docs__get', 'Fetch docs.', 'mcp__docs'),
      tool('disabled', 'Disabled.'),
    ]);
    fixture.options.selectedTools = ['read', 'code_search', 'mcp__docs__get', 'unregistered'];
    fixture.options.toolSnippets = { read: 'Read', code_search: 'Search by behavior' };
    const before = structuredClone(fixture.options);
    fixture.run();
    const { tool_catalog: catalog, ...sections } = fixture.options.sections;
    expect(catalog).toContain('- mcp__docs__get:');
    expect(catalog).not.toMatch(/- (read|code_search|disabled|unregistered):/);
    expect(sections).toEqual(before.sections);
    expect({ ...fixture.options, sections }).toEqual(before);
  });

  it('动态添加、删除、启停每轮重算，复用 options 时清掉旧目录', () => {
    const fixture = setup([tool('a', 'A.')]);
    fixture.options.selectedTools = ['a'];
    fixture.run();
    expect(fixture.options.sections.tool_catalog).toContain('- a:');
    fixture.tools([tool('a', 'A.'), tool('b', 'B.')]);
    fixture.options.selectedTools = ['b'];
    fixture.run();
    expect(fixture.options.sections.tool_catalog).toContain('- b:');
    expect(fixture.options.sections.tool_catalog).not.toContain('- a:');
    fixture.tools([]);
    fixture.run();
    expect(fixture.options.sections).not.toHaveProperty('tool_catalog');
    fixture.tools([tool('a', 'A.')]);
    fixture.options.selectedTools = ['a'];
    fixture.run();
    fixture.options.selectedTools = [];
    fixture.run();
    expect(fixture.options.sections).not.toHaveProperty('tool_catalog');
  });
});
