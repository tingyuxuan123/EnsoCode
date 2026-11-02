import { expect, it } from 'vitest';
import { editorSlashQuery } from './MentionEditor';

it('plugin draft text stays literal while typed slash commands keep their picker', () => {
  expect(editorSlashQuery('/clear', true, false)).toBe('clear');
  expect(editorSlashQuery('/clear', true, true)).toBeNull();
  expect(editorSlashQuery('/clear', false, false)).toBeNull();
  expect(editorSlashQuery('plain /clear', true, false)).toBeNull();
});
