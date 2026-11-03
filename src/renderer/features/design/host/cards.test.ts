import type { ProjectedMessage } from '@shared/types/agent';
import { expect, it } from 'vitest';
import { buildTimeline } from '@/stores/sessions/timeline';
import { applyPendingDesignCards, readDesignCards } from './cards';

it('narrows cards and keeps only the latest anchor for each logical key', () => {
  const descriptor = {
    type: 'vetta:screenshot',
    key: 'd#home',
    title: 'Shot',
    payload: { frameId: 'home' },
  };
  expect(readDesignCards([null, {}, descriptor])).toEqual([descriptor]);
  expect(readDesignCards([descriptor, { ...descriptor, title: 'Latest' }])).toEqual([
    { ...descriptor, title: 'Latest' },
  ]);
  const messages: ProjectedMessage[] = ['a', 'b'].flatMap((id) => [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id, name: 'vetd_screenshot', arguments: { frame: 'home' } }],
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: 'ok' }],
      toolCallId: id,
      toolName: 'vetd_screenshot',
      designCards: [descriptor],
    },
  ]);
  const rows = buildTimeline(messages, false).filter((row) => row.kind === 'tool');
  expect(rows[0].designCards).toEqual([]);
  expect(rows[1].designCards).toEqual([descriptor]);
  expect(rows[1].designArgs).toEqual({ frame: 'home' });
  const pending = { ...rows[1], key: 'pending', state: 'running' as const, designCards: [] };
  const withPending = applyPendingDesignCards(
    [...rows, pending],
    [{ type: descriptor.type, component: () => null, pendingFor: () => descriptor }]
  );
  expect(withPending.filter((row) => row.kind === 'tool').map((row) => row.designCards)).toEqual([
    [],
    [],
    [descriptor],
  ]);
});
