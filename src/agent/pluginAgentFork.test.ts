import { describe, expect, it } from 'vitest';
import { forkRunnable } from './pluginAgentFork';

const child = (active: string[], callable: string[]) =>
  ({
    agent: { state: { tools: active.map((name) => ({ name })) } },
    getCallableToolNames: () => callable,
  }) as unknown as Parameters<typeof forkRunnable>[0];

describe('readonly plugin fork allowlist', () => {
  it('only allows implemented read tools, never declarations alone', () => {
    expect([...forkRunnable(child(['read', 'grep', 'write'], ['read', 'grep', 'write']))]).toEqual([
      'read',
      'grep',
    ]);
  });
  it('codemode is executable only when every callable nested tool is readonly or forbidden', () => {
    const tools = ['read', 'grep', 'find', 'ls', 'codemode', 'explore_mark'];
    expect(forkRunnable(child(tools, tools)).has('codemode')).toBe(true);
    expect(forkRunnable(child(['read', 'codemode'], ['read', 'write'])).has('codemode')).toBe(
      false
    );
    expect(forkRunnable(child(['read', 'codemode'], ['read', 'bash'])).has('codemode')).toBe(false);
    expect(
      forkRunnable(child(['read', 'codemode'], ['read', 'plugin_write'])).has('codemode')
    ).toBe(false);
  });
});
