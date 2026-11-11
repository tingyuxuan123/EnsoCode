import { parseSuperAssistantRequest } from '@shared/superAssistantProtocol';
import { expect, it } from 'vitest';
import {
  createSuperAssistantTool,
  normalizeSuperAssistantParams,
  SUPER_ASSISTANT_PROMPT,
} from './superAssistant';

it('drops known fields for other operations when a strict-schema model populates all properties', async () => {
  const full = {
    operation: 'search',
    query: 'Project',
    projectId: 'p',
    conversationId: 'old',
    prompt: 'unused',
    title: 'unused',
    taskId: 'old',
    limit: 10,
  };
  expect(normalizeSuperAssistantParams(full)).toEqual({
    operation: 'search',
    query: 'Project',
    limit: 10,
  });
  const requests: unknown[] = [];
  await createSuperAssistantTool({
    invoke: async (request) => {
      requests.push(request);
      return {};
    },
  }).execute('c', full, undefined, undefined, undefined as never);
  expect(requests).toEqual([{ operation: 'search', query: 'Project', limit: 10 }]);
  // Unknown fields remain invalid; normalization cannot turn an arbitrary path API into an admitted request.
  expect(
    parseSuperAssistantRequest(normalizeSuperAssistantParams({ ...full, path: '/private' }))
  ).toBeNull();
});

it('normalizes before schema and rejects invalid requests before invoking Main', async () => {
  const requests: unknown[] = [];
  const tool = createSuperAssistantTool({
    invoke: async (request) => {
      requests.push(request);
      return { status: 'dispatched' };
    },
  });
  expect(
    normalizeSuperAssistantParams({ operation: 'history', conversationId: ' s ', limit: '10' })
  ).toEqual({ operation: 'history', conversationId: 's', limit: 10 });
  expect(tool.prepareArguments).toBeTypeOf('function');
  await expect(
    tool.execute(
      'call',
      { operation: 'dispatch', projectId: 'p', prompt: ' ' },
      undefined,
      undefined,
      undefined as never
    )
  ).rejects.toThrow();
  expect(requests).toEqual([]);
  await tool.execute('call', { operation: 'list' }, undefined, undefined, undefined as never);
  expect(requests).toEqual([{ operation: 'list' }]);
  expect(SUPER_ASSISTANT_PROMPT).toContain('untrusted');
});
