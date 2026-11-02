import { afterEach, expect, it } from 'vitest';
import type { MentionSegment } from '@/components/chat/mentionComposer';
import { handleDraftRequest, registerDraftTarget } from './draftBridge';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function target(key = 's1') {
  const state = {
    segments: [{ type: 'text', text: 'hello' }] as MentionSegment[],
    busy: false,
    refs: false,
  };
  disposers.push(
    registerDraftTarget({
      key,
      segments: () => state.segments,
      busy: () => state.busy,
      hasReferences: () => state.refs,
      insertText: (text) => {
        state.segments.push({ type: 'text', text });
      },
      setText: (text) => {
        state.segments = [{ type: 'text', text }];
      },
    })
  );
  return state;
}
function read() {
  const result = handleDraftRequest({ sessionId: 's1', op: 'readDraft', payload: {} });
  expect(result.ok).toBe(true);
  return (result as { value: { generation: string; rev: string; text: string } }).value;
}
it('binds a generation to the window composer lifetime, not merely session id', () => {
  target();
  const first = read();
  expect(first.text).toBe('hello');
  target();
  const second = read();
  expect(second.generation).not.toBe(first.generation);
  expect(
    handleDraftRequest({
      sessionId: 's1',
      op: 'replaceDraft',
      payload: { text: 'late', expect: first },
    })
  ).toMatchObject({ ok: false, code: 'DRAFT_CHANGED' });
  expect(
    handleDraftRequest({ sessionId: 'other-window', op: 'readDraft', payload: {} })
  ).toMatchObject({ ok: false, code: 'NO_COMPOSER' });
});
it('requires optimistic revision for every write, rejects edits, busy/IME and references', () => {
  const state = target();
  const expectVersion = read();
  expect(
    handleDraftRequest({ sessionId: 's1', op: 'replaceDraft', payload: { text: 'unsafe' } })
  ).toMatchObject({ ok: false, code: 'DRAFT_CHANGED' });
  state.segments = [{ type: 'text', text: 'new user input' }];
  expect(
    handleDraftRequest({
      sessionId: 's1',
      op: 'insertText',
      payload: { text: 'late', expect: expectVersion },
    })
  ).toMatchObject({ ok: false, code: 'DRAFT_CHANGED' });
  const fresh = read();
  state.busy = true;
  expect(
    handleDraftRequest({ sessionId: 's1', op: 'insertText', payload: { text: 'x', expect: fresh } })
  ).toMatchObject({ ok: false, code: 'DRAFT_BUSY' });
  state.busy = false;
  state.refs = true;
  expect(
    handleDraftRequest({
      sessionId: 's1',
      op: 'replaceDraft',
      payload: { text: 'x', expect: fresh },
    })
  ).toMatchObject({ ok: false, code: 'DRAFT_HAS_REFERENCES' });
  state.refs = false;
  expect(
    handleDraftRequest({
      sessionId: 's1',
      op: 'replaceDraft',
      payload: { text: '/literal', expect: fresh },
    })
  ).toMatchObject({ ok: true });
  expect(state.segments).toEqual([{ type: 'text', text: '/literal' }]);
});
it('cleans up targets and rejects oversized writes', () => {
  target();
  const expectVersion = read();
  expect(
    handleDraftRequest({
      sessionId: 's1',
      op: 'insertText',
      payload: { text: '字'.repeat(32768), expect: expectVersion },
    })
  ).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  for (const dispose of disposers.splice(0)) dispose();
  expect(handleDraftRequest({ sessionId: 's1', op: 'readDraft', payload: {} })).toMatchObject({
    ok: false,
    code: 'NO_COMPOSER',
  });
});
it('rejects an edited-then-undone draft even when text matches the old snapshot', () => {
  let revision = 0;
  disposers.push(
    registerDraftTarget({
      key: 's1',
      segments: () => [{ type: 'text', text: 'same' }],
      revision: () => revision,
      busy: () => false,
      insertText() {},
      setText() {},
    })
  );
  const snapshot = read();
  revision += 2;
  expect(
    handleDraftRequest({
      sessionId: 's1',
      op: 'replaceDraft',
      payload: { text: 'stale', expect: snapshot },
    })
  ).toMatchObject({ ok: false, code: 'DRAFT_CHANGED' });
});
