import { describe, expect, it } from 'vitest';
import { createComposerDrafts } from './composerDraft';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

describe('composer drafts (not session history)', () => {
  it('旧版string草稿仍可读，多技能只持久化命令不保存技能正文', () => {
    const disk = storage();
    const draft = {
      segments: [{ type: 'text' as const, text: '任务' }],
      images: [],
      slash: '/skill:a /skill:b',
    };
    createComposerDrafts(() => disk).set('a', draft);
    expect(createComposerDrafts(() => disk).get('a')).toEqual(draft);
    expect([...disk.values.values()].join('')).not.toContain('<skill');
  });
  it('survives a new repository with Unicode and ordered mentions isolated by focusKey', () => {
    const disk = storage();
    const drafts = createComposerDrafts(() => disk);
    const draft = {
      segments: [
        { type: 'text' as const, text: '中文 👨‍👩‍👧‍👦\n' },
        { type: 'file' as const, path: 'src/你好.ts', label: '你好' },
        { type: 'chat' as const, label: '讨论 😀', sessionFile: '/sessions/one.jsonl' },
      ],
      images: [],
      slash: '/review',
    };
    drafts.set('a', draft);
    drafts.set('b', { segments: [{ type: 'text', text: 'other' }], images: [], slash: null });
    expect(createComposerDrafts(() => disk).get('a')).toEqual(draft);
    expect(createComposerDrafts(() => disk).get('b')?.segments).not.toEqual(draft.segments);
  });

  it('keeps images only in memory, removes dangling screenshot bindings on reload', () => {
    const disk = storage();
    const drafts = createComposerDrafts(() => disk);
    drafts.set('a', {
      segments: [
        {
          type: 'ui-element',
          id: 'e',
          label: '按钮',
          path: 'button',
          text: '提交',
          imageId: 'img',
        },
      ],
      images: [{ data: 'SECRET_BASE64', mimeType: 'image/png', id: 'img' }],
      slash: null,
    });
    expect(drafts.get('a')?.images).toHaveLength(1);
    expect([...disk.values.values()].join('')).not.toContain('SECRET_BASE64');
    expect(createComposerDrafts(() => disk).get('a')).toMatchObject({
      images: [],
      segments: [{ imageId: '' }],
    });
  });

  it('validates dirty persisted input and strips unknown fields', () => {
    const disk = storage();
    disk.setItem(
      'enso-composer-draft:a',
      JSON.stringify({
        version: 1,
        segments: [
          null,
          { type: 'file', path: 1 },
          { type: 'text', text: '好😀', images: 'secret' },
          { type: 'chat', label: 'bad', sessionFile: null },
          { type: 'unknown', text: 'bad' },
        ],
        slash: {},
        recipient: { kind: 'agent-type', id: 'invalid' },
        images: [{ data: 'bad' }],
      })
    );
    expect(createComposerDrafts(() => disk).get('a')).toEqual({
      segments: [{ type: 'text', text: '好😀' }],
      images: [],
      slash: null,
    });
    disk.setItem('enso-composer-draft:b', '{broken');
    expect(createComposerDrafts(() => disk).get('b')).toBeUndefined();
  });

  it('clears empty/sent/deleted drafts and tolerates unavailable storage', () => {
    const disk = storage();
    const drafts = createComposerDrafts(() => disk);
    const draft = {
      segments: [{ type: 'text' as const, text: 'unsent' }],
      images: [],
      slash: null,
    };
    drafts.set('a', draft);
    drafts.delete('a');
    expect(createComposerDrafts(() => disk).get('a')).toBeUndefined();
    drafts.set('b', draft);
    drafts.set('b', { segments: [], images: [], slash: null });
    expect(disk.values.size).toBe(0);
    const unavailable = createComposerDrafts(() => {
      throw new Error('disabled');
    });
    expect(() => unavailable.set('c', draft)).not.toThrow();
    expect(unavailable.get('c')).toEqual(draft);
  });
});
