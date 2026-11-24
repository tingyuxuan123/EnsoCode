import { describe, expect, it } from 'vitest';
import { isPhoneCommand } from './protocol';

describe('phone command allowlist', () => {
  it('rejects retired Bot commands without changing the Code command surface', () => {
    for (const type of ['bot-catalog-request', 'bot-send', 'bot-thread-select', 'bot-artifacts']) {
      expect(isPhoneCommand({ type }), type).toBe(false);
    }
    for (const type of [
      'snapshot',
      'subscribe',
      'prompt',
      'approval-respond',
      'file-list',
      'preview-open',
    ]) {
      expect(isPhoneCommand({ type }), type).toBe(true);
    }
  });
});
