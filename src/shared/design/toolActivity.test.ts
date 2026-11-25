import { describe, expect, it } from 'vitest';
import { designActivityCalls, isDesignActivityCalls } from './toolActivity';

describe('design file activity', () => {
  it('extracts only paths and kinds, never file contents or shell commands', () => {
    expect(designActivityCalls('r', 'read', { path: 'd.vetd/frames/a.tsx' })).toEqual([
      { id: 'r', toolName: 'read', path: 'd.vetd/frames/a.tsx' },
    ]);
    expect(designActivityCalls('w', 'write', { path: 'a', content: 'private' })).toEqual([
      { id: 'w', toolName: 'write', path: 'a' },
    ]);
    expect(designActivityCalls('b', 'bash', { command: 'echo hi', path: 'a' })).toEqual([]);
    expect(designActivityCalls('r', 'read', null)).toEqual([]);
    expect(designActivityCalls('e', 'edit', { input: '[d.vetd/frames/a.tsx#A123]\nx' })).toEqual([
      { id: 'e', toolName: 'edit', path: 'd.vetd/frames/a.tsx' },
    ]);
  });

  it('extracts complete multi-file patch headers, not partial paths or patch contents', () => {
    expect(
      designActivityCalls('p', 'apply_patch', {
        input:
          '*** Begin Patch\n*** Update File: d.vetd/frames/a.tsx\n+x\n*** Add File: d.vetd/frames/b.tsx\n+x\n*** Update File: d.vetd/comp',
      })
    ).toEqual([
      { id: 'p#0', toolName: 'edit', path: 'd.vetd/frames/a.tsx' },
      { id: 'p#1', toolName: 'write', path: 'd.vetd/frames/b.tsx' },
    ]);
  });

  it('validates bounded path-only activity at the worker boundary', () => {
    const call = { id: 'c/1', toolName: 'read', path: 'd.vetd/frames/a.tsx' };
    expect(isDesignActivityCalls([call])).toBe(true);
    expect(isDesignActivityCalls([{ ...call, isError: false }])).toBe(true);
    for (const calls of [
      null,
      [],
      [{ ...call, toolName: 'bash' }],
      [{ ...call, path: '' }],
      [{ ...call, path: 'x'.repeat(4097) }],
      [{ ...call, isError: 'false' }],
      [{ ...call, content: 'private' }],
      Array(129).fill(call),
    ]) {
      expect(isDesignActivityCalls(calls)).toBe(false);
    }
  });

  it('does not mistake patch context lines for file headers', () => {
    expect(
      designActivityCalls('p', 'apply_patch', {
        input:
          '*** Begin Patch\n*** Update File: d.vetd/frames/a.tsx\n@@\n *** Update File: d.vetd/frames/body.tsx\n-old\n+new\n*** End Patch',
      })
    ).toEqual([{ id: 'p#0', toolName: 'edit', path: 'd.vetd/frames/a.tsx' }]);
  });
});
