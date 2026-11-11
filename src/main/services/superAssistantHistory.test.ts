import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeSuperAssistantSessionFile } from './superAssistantHistory';

describe('super assistant history boundary', () => {
  it('accepts exact registered session files but denies missing/outside/symlink replacements', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'super-history-'));
    try {
      const sessions = path.join(temp, 'sessions');
      mkdirSync(sessions);
      const file = path.join(sessions, 'session.jsonl');
      writeFileSync(file, '{}');
      const outside = path.join(temp, 'secret');
      writeFileSync(outside, 'secret');
      expect(safeSuperAssistantSessionFile(sessions, file)).toBe(realpathSync(file));
      expect(safeSuperAssistantSessionFile(sessions, outside)).toBeNull();
      expect(safeSuperAssistantSessionFile(sessions, path.join(sessions, 'missing'))).toBeNull();
      const link = path.join(sessions, 'link.jsonl');
      symlinkSync(outside, link);
      expect(safeSuperAssistantSessionFile(sessions, link)).toBeNull();
      expect(safeSuperAssistantSessionFile(sessions, sessions)).toBeNull();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
