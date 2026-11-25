// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDraftRequest } from '@/plugins/draftBridge';
import { Composer } from './Composer';
import { composerDrafts, createComposerDrafts } from './composerDraft';
import {
  insertComposerImage,
  insertComposerMention,
  insertComposerText,
  insertUiElementMention,
  insertUiElementMentions,
} from './composerMentionBridge';
import { requestOpenChatModelPicker } from './ModelPicker';
import type { ComposerPayload } from './mentionComposer';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => {
  const state = { keybindings: { 'switch-model': 'alt+m', 'send-message': 'enter' } };
  return {
    useSettingsStore: Object.assign((select: (s: typeof state) => unknown) => select(state), {
      getState: () => state,
    }),
  };
});
// Mutate this set without notifying React to exercise handlers from the last unlocked render.
const pending = vi.hoisted(() => new Set<string>());
vi.mock('@/stores/deviceAccess', () => ({
  usePendingDeviceAccess: (id: string) => pending.has(id),
  hasPendingDeviceAccess: (id: string) => pending.has(id),
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
  pending.clear();
  vi.mocked(requestOpenChatModelPicker).mockClear();
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

const render = (
  focusKey: string,
  onSend: (payload: ComposerPayload) => boolean = vi.fn(() => true),
  props: Partial<ComponentProps<typeof Composer>> = {}
) =>
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
        {...props}
      />
    );
  });
async function type(text: string, placeCaret = false) {
  const editor = container.querySelector<HTMLElement>('[contenteditable]');
  if (!editor) throw new Error('Missing editor');
  await act(async () => {
    editor.textContent = text;
    if (placeCaret && editor.firstChild) {
      editor.focus();
      window.getSelection()?.collapse(editor.firstChild, text.length);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

describe('desktop slash command tray', () => {
  const commands: NonNullable<ComponentProps<typeof Composer>['commands']> = [
    { name: '/goal', description: 'Set a session goal' },
    { name: '/skill:review', description: 'Review code' },
    { name: '/skill:vetta-ui-design', description: 'Design canvas', bundled: true },
  ];
  const editor = () => container.querySelector<HTMLElement>('[role="combobox"]')!;
  const panel = () => container.querySelector('[data-slot="composer-command-tray"]');
  const key = (value: string) =>
    act(async () => {
      editor().dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
      );
    });

  it('shows built-ins first; pressing Enter keeps the same icon and sends nothing', async () => {
    const onSend = vi.fn(() => true);
    await render('draft-a', onSend, { commands });
    await type('/', true);
    const active = document.getElementById(editor().getAttribute('aria-activedescendant') ?? '');
    const picture = active?.querySelector('img')?.getAttribute('src');
    expect(active?.textContent).toContain('Vetta Design');
    expect(picture).toBeTruthy();
    await key('Enter');
    expect(panel()).toBeNull();
    const chip = container.querySelector('[data-slot="composer-command-chip"]');
    expect(chip?.querySelector('img')?.getAttribute('src')).toBe(picture);
    expect(chip?.textContent).toBe('Vetta Design');
    expect(onSend).not.toHaveBeenCalled();
    await type('Make a mockup', true);
    await key('Enter');
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: '/skill:vetta-ui-design Make a mockup' })
    );
  });

  it('previews a toolbar action and fills plain text without running it', async () => {
    const onSend = vi.fn(() => true);
    await render('draft-a', onSend, { commands, commandPrompts: ['image'] });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-composer-command-toggle]')?.click()
    );
    const action = [
      ...(panel()?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
    ].find((option) => option.textContent?.includes('Image generation'));
    await act(async () => action?.click());
    expect(panel()?.querySelector('[data-command-preview]')?.textContent).toContain(
      'Image generation'
    );
    await key('Enter');
    expect(panel()).toBeNull();
    expect(editor().textContent).toContain('Generate an image');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('confirms a row with one click when the narrow tray hides its preview', async () => {
    const onSend = vi.fn(() => true);
    await render('draft-a', onSend, { commands, commandPrompts: ['image'] });
    await type('/', true);
    // happy-dom does not apply Tailwind container queries; exercise the hidden layout state.
    const preview = panel()?.querySelector<HTMLElement>('[data-command-preview]');
    expect(preview).not.toBeNull();
    preview!.style.display = 'none';
    const option = [
      ...(panel()?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
    ].find((row) => row.textContent?.includes('Image generation'));
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(panel()).toBeNull();
    expect(editor().textContent).toContain('Generate an image');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('allows Escape to dismiss the derived goal options', async () => {
    await render('draft-a', undefined, { commands });
    await type('/goal', true);
    await key('Tab');
    expect(panel()?.textContent).toContain('pause');
    await key('Escape');
    expect(panel()).toBeNull();
    await type('res', true);
    expect(panel()?.textContent).toContain('resume');
  });

  it('keeps the legacy picker on phones', async () => {
    await render('draft-a', undefined, { commands, appearance: 'phone' });
    await type('/', true);
    expect(panel()).toBeNull();
    expect(container.querySelector('[role="listbox"]')?.firstElementChild?.textContent).toContain(
      '/goal'
    );
    expect(container.querySelector('[data-composer-command-toggle]')).toBeNull();
  });
});

describe('Composer pending device access', () => {
  // The plugin/draft target can have a different key from the session requesting access.
  const focusKey = 'draft-a';
  const deviceAccessSessionId = 'device-session';
  const props = { deviceAccessSessionId };
  const editor = () => container.querySelector<HTMLElement>('[role="combobox"]')!;
  const send = () =>
    container.querySelector<HTMLButtonElement>('[data-composer-action-button="send"]')!;
  const keydown = (key: string, init?: KeyboardEventInit) =>
    editor().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: key, key, ...init })
    );

  it('locks only the requested session and preserves its existing draft on unlock', async () => {
    const onSend = vi.fn(() => false);
    pending.add(focusKey);
    await render(focusKey, onSend, props);
    await type('keep this draft');
    expect(editor().getAttribute('contenteditable')).toBe('true');
    expect(send().disabled).toBe(false);

    pending.add(deviceAccessSessionId);
    await render(focusKey, onSend, props);
    expect(editor().getAttribute('contenteditable')).toBe('false');
    expect(send().disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Attach image"]')!.disabled
    ).toBe(true);

    pending.delete(deviceAccessSessionId);
    await render(focusKey, onSend, props);
    await act(async () => send().click());
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'keep this draft' }));
  });

  it('checks current access for Send, Enter and switch-model before React rerenders', async () => {
    const onSend = vi.fn(() => false);
    await render(focusKey, onSend, props);
    await type('do not submit yet');
    const shortcuts = () => {
      keydown('Enter');
      keydown('m', { code: 'KeyM', altKey: true });
    };
    await act(async () => shortcuts());
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'do not submit yet' }));
    expect(requestOpenChatModelPicker).toHaveBeenCalledOnce();
    onSend.mockClear();
    vi.mocked(requestOpenChatModelPicker).mockClear();
    pending.add(deviceAccessSessionId);
    expect(send().disabled).toBe(false);
    await act(async () => {
      send().click();
      shortcuts();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(requestOpenChatModelPicker).not.toHaveBeenCalled();
  });

  it('does not steer the queued message with Enter during the pre-render gap', async () => {
    const onSteerQueued = vi.fn();
    await render(focusKey, undefined, { ...props, running: true, queuedCount: 1, onSteerQueued });
    pending.add(deviceAccessSessionId);
    await act(async () => {
      keydown('Enter');
    });
    expect(onSteerQueued).not.toHaveBeenCalled();
    pending.delete(deviceAccessSessionId);
    await act(async () => {
      keydown('Enter');
    });
    expect(onSteerQueued).toHaveBeenCalledOnce();
  });

  it('rejects external inserts without changing the draft or images before rerender', async () => {
    const onSend = vi.fn(() => false);
    await render(focusKey, onSend, props);
    await type('original');
    const candidate = {
      kind: 'ui-element' as const,
      id: 'save',
      label: 'Save',
      path: '#save',
      text: 'Save',
      imageId: 'image-1',
    };
    const image = { data: 'YQ==', mimeType: 'image/png' };
    pending.add(deviceAccessSessionId);
    await act(async () => {
      insertComposerText('injected');
      insertComposerMention({ kind: 'file', id: 'a.ts', relativePath: 'a.ts', label: 'a.ts' });
      insertComposerImage(image);
      insertUiElementMention(candidate, image);
      expect(insertUiElementMentions([{ candidate, image }], focusKey)).toBe(false);
    });
    pending.delete(deviceAccessSessionId);
    await render(focusKey, onSend, props);
    await act(async () => send().click());
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'original', images: [], mentions: [] })
    );
  });

  it('rejects a valid plugin draft edit while pending, without invalidating its revision', async () => {
    await render(focusKey, undefined, props);
    const read = handleDraftRequest({ sessionId: focusKey, op: 'readDraft', payload: {} });
    if (!read.ok) throw new Error(read.error);
    const { generation, rev } = read.value as { generation: number; rev: number };
    const insert = () =>
      handleDraftRequest({
        sessionId: focusKey,
        op: 'insertText',
        payload: { text: 'from plugin', expect: { generation, rev } },
      });
    pending.add(deviceAccessSessionId);
    await act(async () => {
      expect(insert().ok).toBe(false);
    });
    expect(editor().textContent).toBe('');
    pending.delete(deviceAccessSessionId);
    await act(async () => {
      expect(insert().ok).toBe(true);
    });
    expect(editor().textContent).toBe('from plugin');
  });

  it('defers injected draft and initial recipient until resolved, then consumes each once', async () => {
    const recipient = {
      kind: 'agent-type',
      typeKey: 'agent:enso',
      id: 'agent:enso',
      label: 'Enso',
      displayName: 'Enso',
      description: 'System agent',
      source: 'system',
      locked: true,
      canDisable: false,
      canEdit: false,
    } as const;
    const onSend = vi.fn(() => false);
    const inject = {
      ...props,
      injectedDraft: 'reply later',
      initialRecipient: recipient,
      onDraftConsumed: vi.fn(),
      onInitialRecipientConsumed: vi.fn(),
    };
    pending.add(deviceAccessSessionId);
    await render(focusKey, onSend, inject);
    expect(editor().textContent).toBe('');
    expect(container.textContent).not.toContain(recipient.displayName);
    expect(inject.onDraftConsumed).not.toHaveBeenCalled();
    expect(inject.onInitialRecipientConsumed).not.toHaveBeenCalled();

    pending.delete(deviceAccessSessionId);
    await render(focusKey, onSend, inject);
    await act(async () => send().click());
    expect(inject.onDraftConsumed).toHaveBeenCalledOnce();
    expect(inject.onInitialRecipientConsumed).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'reply later', recipient })
    );
  });

  it('discards an image whose read completes after access becomes pending', async () => {
    let finish!: () => void;
    const readAsDataURL = vi.fn(function (this: FileReader) {
      finish = () => {
        Object.defineProperty(this, 'result', { value: 'data:image/png;base64,YQ==' });
        this.dispatchEvent(new ProgressEvent('load'));
      };
    });
    const reader = vi
      .spyOn(FileReader.prototype, 'readAsDataURL')
      .mockImplementation(readAsDataURL);
    try {
      const onSend = vi.fn(() => false);
      await render(focusKey, onSend, props);
      await type('keep text');
      const file = new File(['a'], 'a.png', { type: 'image/png' });
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: [file] });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(reader).toHaveBeenCalledWith(file);
      pending.add(deviceAccessSessionId);
      await act(async () => finish());
      pending.delete(deviceAccessSessionId);
      await render(focusKey, onSend, props);
      await act(async () => send().click());
      expect(onSend).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'keep text', images: [] })
      );
    } finally {
      reader.mockRestore();
    }
  });
});

describe('Composer draft lifecycle', () => {
  it('appends browser picks after the draft as an ordered batch with their own attachments', async () => {
    const onSend = vi.fn((_payload: ComposerPayload) => false);
    await render('draft-send', onSend);
    await type('Original draft');
    const items = ['Save', 'Cancel'].map((label, i) => ({
      candidate: {
        kind: 'ui-element' as const,
        id: label,
        label,
        path: `#${label}`,
        text: label,
        imageId: `img-${i}`,
      },
      image: { data: ['YQ==', 'Yg=='][i], mimeType: 'image/png' },
      note: `Note ${i + 1}`,
    }));
    expect(insertUiElementMentions(items, 'draft-a')).toBe(false);
    await act(async () => {
      expect(insertUiElementMentions(items, 'draft-send')).toBe(true);
    });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.click()
    );
    const payload = onSend.mock.calls[0]?.[0];
    expect(payload?.text).toMatch(
      /Original draft[\s\S]*Selected UI element "Save"[\s\S]*Note 1[\s\S]*Selected UI element "Cancel"[\s\S]*Note 2/
    );
    expect(payload?.images).toEqual(items.map((item) => item.image));
  });
  it('直接输入或粘贴完整前缀链产生多个chips且不吞任务正文', async () => {
    const onSend = vi.fn((_payload: ComposerPayload) => false);
    await render('draft-send', onSend);
    await type('/skill:a /skill:中文 任务 /skill:not-leading');
    expect(container.querySelectorAll('[data-slot="composer-command-chip"]')).toHaveLength(2);
    expect(container.querySelector('[contenteditable]')?.textContent).toBe(
      '任务 /skill:not-leading'
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click()
    );
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      text: '/skill:a /skill:中文 任务 /skill:not-leading',
    });
  });
  it.each(['rejected', 'throws'])(
    '多技能chips首挂载、失败%s保留、单独删除并重试仍发送原命令',
    async (mode) => {
      composerDrafts.set('draft-send', {
        segments: [{ type: 'text', text: '任务' }],
        images: [],
        slash: '/skill:a /skill:b',
      });
      const onSend = vi.fn((_payload: ComposerPayload) => {
        if (mode === 'throws') throw new Error('transport failed');
        return false;
      });
      await render('draft-send', onSend);
      expect(container.querySelectorAll('[data-slot="composer-command-chip"]')).toHaveLength(2);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click()
      );
      expect(onSend.mock.calls[0]?.[0]).toMatchObject({ text: '/skill:a /skill:b 任务' });
      expect(createComposerDrafts(() => localStorage).get('draft-send')?.slash).toBe(
        '/skill:a /skill:b'
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-slot="composer-command-chip"]')!.click()
      );
      expect(container.querySelectorAll('[data-slot="composer-command-chip"]')).toHaveLength(1);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click()
      );
      expect(onSend.mock.calls[1]?.[0]).toMatchObject({ text: '/skill:b 任务' });
    }
  );
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
