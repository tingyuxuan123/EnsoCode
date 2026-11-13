import { expect, it } from 'vitest';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

it('设计面板中英文引导统一使用 Collabra，不保留旧助手自称', () => {
  for (const messages of [en, zh]) {
    expect(Object.values(messages).some((text) => /\bEnso\b/.test(text))).toBe(false);
    for (const key of [
      'canvas.ask.badge',
      'canvas.ask.placeholder',
      'notes.handle.one',
      'history.drawer.empty',
    ] as const) {
      expect(messages[key]).toContain('Collabra');
    }
  }
});
