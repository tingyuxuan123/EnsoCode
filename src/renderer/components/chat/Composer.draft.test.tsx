// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import { composerDrafts, createComposerDrafts } from './composerDraft';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) => select({ keybindings: {} }),
}));
vi.mock('@/hooks/useMentionSearch', () => ({
  useMentionSearch: () => ({}),
  flattenMentionRoot: () => [],
}));
vi.mock('../../plugins/slots', () => ({ PluginComposerSlots: () => null }));
vi.mock('../../plugins/triggers', () => ({
  usePluginTriggerCandidates: () => [],
  extractTriggerQuery: () => null,
}));
vi.mock('./ModelPicker', () => ({ requestOpenChatModelPicker: vi.fn() }));
vi.mock('./VoiceInputButton', () => ({ VoiceInputButton: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  for (const key of ['draft-a', 'draft-b', 'draft-send']) composerDrafts.delete(key);
});

const render = (focusKey: string, onSend = vi.fn(() => true)) =>
  act(async () => {
    root.render(
      <Composer
        focusKey={focusKey}
        autoFocus={false}
        commands={[]}
        running={false}
        busy={false}
        onSend={onSend}
        onAbort={() => {}}
      />
    );
  });
async function type(text: string) {
  const editor = container.querySelector<HTMLElement>('[contenteditable]');
  if (!editor) throw new Error('Missing editor');
  await act(async () => {
    editor.textContent = text;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

describe('Composer draft lifecycle', () => {
  it('restores on first mount, writes while editing, and isolates focusKey switches', async () => {
    composerDrafts.set('draft-a', {
      segments: [{ type: 'text', text: '原草稿😀' }],
      images: [],
      slash: null,
    });
    await render('draft-a');
    expect(container.textContent).toContain('原草稿😀');
    await type('中文 👩‍💻');
    expect(createComposerDrafts(() => localStorage).get('draft-a')?.segments).toEqual([
      { type: 'text', text: '中文 👩‍💻' },
    ]);
    await render('draft-b');
    expect(container.textContent).not.toContain('中文 👩‍💻');
    await type('另一个');
    await render('draft-a');
    expect(container.textContent).toContain('中文 👩‍💻');
    await act(async () => root.unmount());
    root = createRoot(container);
    await render('draft-a');
    expect(container.textContent).toContain('中文 👩‍💻');
  });

  it('keeps rejected asynchronous sends, blocks duplicates, clears only after acceptance', async () => {
    let finish!: (ok: boolean) => void;
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    await act(async () =>
      root.render(
        <Composer
          focusKey="draft-send"
          autoFocus={false}
          commands={[]}
          running={false}
          busy={false}
          onSend={onSend}
          onAbort={() => {}}
        />
      )
    );
    await type('不要丢失😀');
    const send = () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
    await act(async () => {
      send();
      send();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('不要丢失😀');
    await act(async () => finish(false));
    expect(createComposerDrafts(() => localStorage).get('draft-send')?.segments).toEqual([
      { type: 'text', text: '不要丢失😀' },
    ]);
    await act(async () => send());
    await act(async () => finish(true));
    expect(container.querySelector('[contenteditable]')?.textContent).toBe('');
    expect(createComposerDrafts(() => localStorage).get('draft-send')).toBeUndefined();
  });

  it('does not recreate a deleted session draft while switching away', async () => {
    await render('draft-a');
    await type('deleted draft');
    composerDrafts.delete('draft-a');
    await render('draft-b');
    expect(createComposerDrafts(() => localStorage).get('draft-a')).toBeUndefined();
  });
});
