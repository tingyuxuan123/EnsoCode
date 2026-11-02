import { describe, expect, it } from 'vitest';
import { DESIGN_TOOL_NAMES } from '../types/design';
import { DESIGN_TOOL_SCHEMAS, type DesignArgumentSchema } from './toolSchemas';

describe('design schemas', () => {
  it('exports all eleven upstream definitions in contract order with fully typed properties', () => {
    expect(DESIGN_TOOL_SCHEMAS.map((tool) => tool.name)).toEqual(DESIGN_TOOL_NAMES);
    const check = (schema: DesignArgumentSchema) => {
      expect(['object', 'array', 'string', 'number', 'boolean']).toContain(schema.type);
      for (const field of Object.values(schema.properties ?? {})) check(field);
      if (schema.items) check(schema.items);
      if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties);
    };
    for (const tool of DESIGN_TOOL_SCHEMAS) {
      expect(tool.description.length).toBeGreaterThan(100);
      expect(tool.parameters.type).toBe('object');
      check(tool.parameters);
    }
  });
});
