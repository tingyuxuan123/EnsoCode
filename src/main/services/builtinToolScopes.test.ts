import { describe, expect, it } from 'vitest';
import { BuiltinToolScopes, sessionDisabledTools } from './builtinToolScopes';

const identity = (sessionId: string, generation = 'g1') => ({ sessionId, generation });

describe('builtin tool scopes', () => {
  it('uses project override, fixed restrictions, platform and default-off tools', () => {
    const state = {
      disabledBuiltinTools: ['web'],
      projects: [{ id: 'p', disabledBuiltinTools: ['todo', 'todo'] }],
    };
    expect(sessionDisabledTools(state, 'p', ['plan', 'plan'], true)).toEqual(['plan', 'todo']);
    expect(sessionDisabledTools(state, undefined, [], false)).toEqual(['computer', 'web']);
    expect(sessionDisabledTools(undefined, undefined, [], true)).toEqual([
      'code_search',
      'computer',
      'memory',
    ]);
  });

  it('dedupes semantic sets per session, pins spawn-only settings, and forgets/reset scopes', () => {
    const scopes = new BuiltinToolScopes();
    scopes.remember(identity('a'), 'p', [], ['memory', 'isolated_sandbox']);
    scopes.remember(identity('b'), undefined, ['plan'], ['plan', 'memory']);
    const next = {
      disabledBuiltinTools: [],
      projects: [{ id: 'p', disabledBuiltinTools: ['memory'] }],
    };
    expect(scopes.changes(next, true)).toEqual([
      { identity: identity('b'), disabledTools: ['plan'] },
    ]);
    expect(scopes.changes(next, true)).toEqual([]);
    scopes.forget('b');
    expect(scopes.changes({ disabledBuiltinTools: ['web', 'web'] }, true)).toEqual([
      { identity: identity('a'), disabledTools: ['isolated_sandbox', 'web'] },
    ]);
    expect(scopes.changes({ disabledBuiltinTools: ['web', 'isolated_sandbox'] }, true)).toEqual([]);
    scopes.clear();
    expect(scopes.changes({ disabledBuiltinTools: [] }, true)).toEqual([]);
  });

  it('replaces old generations and snapshots inputs', () => {
    const scopes = new BuiltinToolScopes();
    const parent = identity('a');
    const fixed = ['plan'];
    scopes.remember(parent, undefined, fixed, ['plan', 'memory']);
    scopes.remember(identity('a', 'g2'), undefined, fixed, ['plan', 'memory']);
    parent.generation = 'dirty';
    fixed.length = 0;
    expect(scopes.changes({ disabledBuiltinTools: [] }, true)).toEqual([
      { identity: identity('a', 'g2'), disabledTools: ['plan'] },
    ]);
  });

  it('warm same-generation spawn cannot replace spawn-fixed restrictions', () => {
    const scopes = new BuiltinToolScopes();
    scopes.remember(identity('a'), undefined, ['plan'], ['workspace_write', 'memory', 'plan']);
    scopes.remember(identity('a'), undefined, [], []);
    expect(scopes.changes({ disabledBuiltinTools: [] }, true)).toEqual([
      { identity: identity('a'), disabledTools: ['plan', 'workspace_write'] },
    ]);
  });
});
