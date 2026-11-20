import { describe, expect, it, vi } from 'vitest';
import { createMemoryTools, MemoryInvoker } from './memory';

interface JsonSchemaObj {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      enum?: readonly unknown[];
      items?: { type: string };
      minimum?: number;
      maximum?: number;
    }
  >;
  required: string[];
  additionalProperties: boolean;
}

/** 回归防线：每个工具的 schema 属性都必须显式声明 type，且 prepareArguments 的输出必须满足自身 schema */
function assertMatchesSchema(schema: JsonSchemaObj, value: Record<string, unknown>): void {
  expect(schema.type).toBe('object');
  expect(schema.additionalProperties).toBe(false);
  for (const [k, prop] of Object.entries(schema.properties)) {
    expect(typeof prop.type, `property ${k} must declare type`).toBe('string');
  }
  for (const key of Object.keys(value)) {
    const prop = schema.properties[key];
    expect(prop, `unexpected key ${key} outside schema`).toBeDefined();
    const v = value[key];
    if (prop.type === 'string') expect(typeof v, key).toBe('string');
    if (prop.type === 'integer') {
      expect(Number.isInteger(v), key).toBe(true);
      if (prop.minimum !== undefined) expect(v as number).toBeGreaterThanOrEqual(prop.minimum);
      if (prop.maximum !== undefined) expect(v as number).toBeLessThanOrEqual(prop.maximum);
    }
    if (prop.type === 'boolean') expect(typeof v, key).toBe('boolean');
    if (prop.type === 'array') {
      expect(Array.isArray(v), key).toBe(true);
      if (prop.items?.type === 'string') {
        for (const item of v as unknown[]) expect(typeof item).toBe('string');
      }
    }
    if (prop.enum) expect(prop.enum, key).toContain(v);
  }
  for (const req of schema.required) {
    expect(value[req], `missing required ${req}`).toBeDefined();
  }
}

describe('wiki memory agent tools', () => {
  const makeTools = () => {
    const emit = vi.fn();
    const invoker = new MemoryInvoker({ sessionId: 's1', generation: 'gen-1' }, emit);
    const tools = createMemoryTools(invoker, { language: 'zh' });
    return { tools, emit, invoker };
  };

  it('exposes the 5 wiki tools with complete typed schemas and passes prepareArguments → schema invariant', () => {
    const { tools } = makeTools();
    expect(tools.map((t) => t.name)).toEqual([
      'memory_index',
      'memory_search',
      'memory_read',
      'memory_upsert',
      'memory_archive',
    ]);

    const samples: Record<string, Record<string, unknown>> = {
      memory_index: { spaceId: ' PROJECT ', type: 'Systems', limit: '40', includeRaw: 'true' },
      memory_search: {
        q: 'OAuth 刷新',
        space: 'all',
        category: 'incidents',
        status: 'verified',
        limit: 99,
      },
      memory_read: { slug: 'systems/auth', spaceId: 'project' },
      memory_upsert: {
        slug: 'systems/auth',
        title: '认证系统',
        category: 'systems',
        summary: '说明',
        body: '内容 [[incidents/oauth]]',
        mode: 'section',
        section: '已知坑点',
        tags: 'oauth, mcp',
        sources: 'src/auth.ts',
        staleAfter: '2027-01-01',
        resource: '',
      },
      memory_archive: { slug: 'old-note', superseded_by: '[[new-note]]', reason: 'outdated' },
    };

    for (const tool of tools) {
      const prepared = (tool.prepareArguments as (raw: unknown) => Record<string, unknown>)(
        samples[tool.name]
      );
      assertMatchesSchema(tool.parameters as unknown as JsonSchemaObj, prepared);
    }
  });

  it('routes execute calls through MemoryInvoker and resolves JSON response', async () => {
    const emit = vi.fn();
    const invoker = new MemoryInvoker({ sessionId: 's1', generation: 'gen-1' }, emit);
    const searchTool = createMemoryTools(invoker).find((t) => t.name === 'memory_search')!;

    const promise = searchTool.execute(
      'call-1',
      { query: 'auth' },
      undefined,
      undefined,
      undefined as never
    );
    expect(emit).toHaveBeenCalledTimes(1);
    const req = emit.mock.calls[0][0];
    expect(req.op).toBe('search');
    invoker.resolve({
      requestId: req.requestId,
      ok: true,
      result: { results: [{ slug: 'systems/auth' }] },
    });

    const out = await promise;
    expect(out.content[0]).toEqual({
      type: 'text',
      text: JSON.stringify({ results: [{ slug: 'systems/auth' }] }),
    });
  });

  it('defaults tool language hint to Simplified Chinese while preserving explicit English', () => {
    const emit = vi.fn();
    const invoker = new MemoryInvoker({ sessionId: 's1', generation: 'gen-1' }, emit);
    const defaultUpsert = createMemoryTools(invoker).find((t) => t.name === 'memory_upsert')!;
    const englishUpsert = createMemoryTools(invoker, { language: 'en' }).find(
      (t) => t.name === 'memory_upsert'
    )!;
    expect(defaultUpsert.description).toContain('Simplified Chinese');
    expect(englishUpsert.description).toContain('English');
  });
});
