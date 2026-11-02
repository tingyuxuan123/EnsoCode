import { describe, expect, it } from 'vitest';
import { DraftBroker } from './draftBroker';

describe('draft response window binding', () => {
  it('rejects forged response and only resolves issuing window, disposes pending', async () => {
    let requestId = '';
    const b = new DraftBroker({
      channel: 'draft',
      find: (id) => ({
        id,
        send: (_ch, payload: unknown) => {
          requestId = (payload as { requestId: string }).requestId;
        },
        isDestroyed: () => false,
      }),
    });
    const result = b.request(7, 's', 'readDraft', {});
    b.respond(8, { requestId, ok: true, value: 'forged' });
    expect(b.pendingCount).toBe(1);
    b.respond(7, { requestId, ok: true, value: 'real' });
    expect(await result).toBe('real');
    const pending = b.request(7, 's', 'readDraft', {});
    b.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(b.pendingCount).toBe(0);
  });
});
