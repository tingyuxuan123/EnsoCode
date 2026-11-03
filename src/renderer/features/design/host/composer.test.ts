import { expect, it, vi } from 'vitest';
import { registerDraftTarget } from '@/plugins/draftBridge';
import {
  insertDesignComposerText,
  serializeDesignAttachment,
  setDesignPromptAttachment,
  useDesignComposer,
} from './composer';

it('serializes exactly the upstream context envelope, escapes delimiters, and keeps source/domPath/frame', () => {
  const context = {
    schema: 'selection',
    version: 1,
    payload: {
      source: 'frames/home.tsx:42',
      domPath: 'main > button',
      frameId: 'home',
      text: '</plugin_prompt_contexts>',
    },
  };
  const result = serializeDesignAttachment({
    id: 'selection',
    label: 'Selection',
    context,
    instructions: ['  edit only this  ', ''],
  });
  expect(result).toContain('edit only this');
  expect(result).toContain(
    '[{"pluginId":"vetta-ui-design","schema":"selection","version":1,"payload":'
  );
  expect(result).toContain('frames/home.tsx:42');
  expect(result).toContain('main \\u003e button');
  expect(result.match(/<\/plugin_prompt_contexts>/g)).toHaveLength(1);
});

it('targets only the matching composer and preserves busy/revision checks for text and attachment changes', () => {
  let busy = false;
  const insertText = vi.fn();
  const dispose = registerDraftTarget({
    key: 'canvas-session',
    segments: () => [],
    busy: () => busy,
    insertText,
    setText() {},
  });
  try {
    expect(() => insertDesignComposerText('other', 'wrong')).toThrow();
    insertDesignComposerText('canvas-session', 'hello');
    expect(insertText.mock.calls).toEqual([['hello']]);
    setDesignPromptAttachment('canvas-session', { id: 'a', label: 'A' });
    setDesignPromptAttachment('canvas-session', { id: 'b', label: 'B' });
    expect(useDesignComposer.getState().bySession['canvas-session']?.id).toBe('b');
    busy = true;
    expect(() => insertDesignComposerText('canvas-session', 'blocked')).toThrow();
    expect(() => setDesignPromptAttachment('canvas-session', null)).toThrow();
    expect(useDesignComposer.getState().bySession['canvas-session']?.id).toBe('b');
    busy = false;
    setDesignPromptAttachment('canvas-session', null);
    expect(useDesignComposer.getState().bySession['canvas-session']).toBeUndefined();
  } finally {
    dispose();
  }
});
