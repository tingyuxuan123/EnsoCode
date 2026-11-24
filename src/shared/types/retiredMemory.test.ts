import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOLS, HOT_BUILTIN_TOOL_IDS } from './builtinTools';
import { IPC_CHANNELS } from './ipc';

describe('retired built-in memory', () => {
  it('does not expose the legacy vault API or advertise the memory tool', () => {
    expect(Object.values(IPC_CHANNELS).filter((channel) => channel.startsWith('memory:'))).toEqual(
      []
    );
    expect(BUILTIN_TOOLS.map(({ id }) => id)).not.toContain('memory');
    expect(HOT_BUILTIN_TOOL_IDS).not.toContain('memory');
  });
});
