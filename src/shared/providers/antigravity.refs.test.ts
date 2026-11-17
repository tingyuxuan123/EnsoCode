import { describe, expect, it } from 'vitest';
import { convertTools, expandSchemaRefs } from './antigravity';

describe('Antigravity local schema references', () => {
  it('expands definitions before Gemini normalization without mutating the input', () => {
    const schema = {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { $ref: '#/$defs/Row' } },
        legacy: { $ref: '#/definitions/A~1B', description: 'override' },
        escaped: { $ref: '#/definitions/C~0D' },
      },
      $defs: { Row: { type: 'object', properties: { kind: { const: 'row' } } } },
      definitions: {
        'A/B': { type: 'string', description: 'original' },
        'C~D': { type: 'number' },
      },
    };
    const before = JSON.stringify(schema);
    const tools = convertTools([
      { name: 'notion', description: 'test', parameters: schema } as never,
    ]);
    const declaration = tools?.[0]?.functionDeclarations[0] as { parameters: unknown } | undefined;
    const parameters = declaration?.parameters;
    expect(parameters).toMatchObject({
      properties: {
        rows: { items: { type: 'object', properties: { kind: { enum: ['row'] } } } },
        legacy: { type: 'string', description: 'override' },
        escaped: { type: 'number' },
      },
    });
    expect(JSON.stringify(parameters)).not.toMatch(/"\$(?:ref|defs)"|"definitions"/);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it('degrades cycles, unresolved and external references without fetching', () => {
    expect(
      expandSchemaRefs({
        properties: {
          root: { $ref: '#/$defs/A' },
          missing: { $ref: '#/$defs/Missing', description: 'kept' },
          external: { $ref: 'https://example.com/schema' },
        },
        $defs: {
          A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/$defs/A' } } },
        },
      })
    ).toEqual({
      properties: {
        root: { type: 'object', properties: { b: { type: 'object', properties: { a: {} } } } },
        missing: { description: 'kept' },
        external: {},
      },
    });
  });

  it('bounds diamond expansion rather than allocating exponentially', () => {
    const defs: Record<string, unknown> = { Leaf: { type: 'string' } };
    let previous = 'Leaf';
    for (let index = 0; index < 10; index += 1) {
      const name = `Level${index}`;
      defs[name] = {
        anyOf: Array.from({ length: 5 }, () => ({ $ref: `#/$defs/${previous}` })),
      };
      previous = name;
    }
    const output = JSON.stringify(expandSchemaRefs({ $ref: `#/$defs/${previous}`, $defs: defs }));
    expect(output.length).toBeLessThan(500_000);
    expect(output).not.toContain('"$ref"');
  });
});
