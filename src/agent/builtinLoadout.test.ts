import { describe, expect, it } from 'vitest';
import { enabledHotBuiltins, HOT_BUILTIN_TOOL_IDS, nextActiveToolNames } from './builtinLoadout';

describe('builtin loadout', () => {
  it('workflow depends on subagent; code_search is hot, spawn-only capabilities are not', () => {
    const enabled = enabledHotBuiltins(['subagent', 'isolated_sandbox']);
    expect(enabled.has('workflow')).toBe(false);
    expect(enabled.has('subagent')).toBe(false);
    expect(enabled.has('code_search')).toBe(true);
    for (const id of ['isolated_sandbox', 'workspace_write', 'goal']) {
      expect(HOT_BUILTIN_TOOL_IDS as readonly string[]).not.toContain(id);
    }
  });

  it('keeps MCP, codemode and unrelated tools in order, without duplicates', () => {
    const groups = new Map([
      ['browser', ['browser_open', 'browser_click']],
      ['code_search', ['code_search']],
      ['todo', ['todo']],
    ]);
    const next = nextActiveToolNames(
      ['read', 'browser_open', 'mcp__x', 'codemode', 'todo'],
      groups,
      new Set(['todo', 'code_search'])
    );
    expect(next).toEqual(['read', 'mcp__x', 'codemode', 'todo', 'code_search']);
    expect(nextActiveToolNames(next, groups, new Set(['todo', 'code_search']))).toEqual(next);
  });
});
