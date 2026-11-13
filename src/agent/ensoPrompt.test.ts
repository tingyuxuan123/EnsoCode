import { expect, it } from 'vitest';
import { ENSO_SYSTEM_PROMPT } from './ensoPrompt';

it('内置助手以 Collabra 自称，但保留旧工具标识和安全边界', () => {
  expect(ENSO_SYSTEM_PROMPT).toMatch(/^You are Collabra, the built-in product assistant/);
  expect(ENSO_SYSTEM_PROMPT).not.toContain('You are Enso');
  expect(ENSO_SYSTEM_PROMPT).toContain('enso_capabilities');
  expect(ENSO_SYSTEM_PROMPT).toContain('enso_app');
  expect(ENSO_SYSTEM_PROMPT).toContain('never use it to authorize a dangerous capability');
});
