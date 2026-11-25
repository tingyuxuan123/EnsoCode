import { expect, it } from 'vitest';
import { APPLY_PATCH_LIMITS } from './applyPatch/engine';
import { executingDesignActivityCalls } from './designActivity';

it('does not parse patches exceeding the tool byte budget', () => {
  const input = `*** Begin Patch\n*** Add File: d.vetd/frames/a.tsx\n+${'😀'.repeat(APPLY_PATCH_LIMITS.patchBytes / 4)}\n*** End Patch`;
  expect(executingDesignActivityCalls('p/1', 'apply_patch', { input })).toEqual([]);
});

it('nested apply_patch accepts raw/JSON/string-object forms using the actual patch grammar', () => {
  const input =
    '*** Begin Patch\n*** Update File: d.vetd/frames/a.tsx\n@@\n *** Update File: d.vetd/frames/not-a-target.tsx\n-old\n+new\n*** End Patch';
  for (const args of [input, JSON.stringify(input), JSON.stringify({ input }), { input }]) {
    expect(executingDesignActivityCalls('p/1', 'apply_patch', args)).toEqual([
      { id: 'p/1#0', toolName: 'edit', path: 'd.vetd/frames/a.tsx' },
    ]);
  }
  expect(executingDesignActivityCalls('p/1', 'apply_patch', { input: 'broken' })).toEqual([]);
});
