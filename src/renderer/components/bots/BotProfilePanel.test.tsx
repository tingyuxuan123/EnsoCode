// @vitest-environment happy-dom
import type { ThinkingLevel } from '@shared/types/agent';
import type { BotChat, BotProfile } from '@shared/types/bot';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BotProfilePanel } from './BotProfilePanel';

const h = vi.hoisted(() => ({
  bots: [] as BotProfile[],
  upsertBot: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/stores/bots', () => ({
  useBotsStore: Object.assign((select: (s: unknown) => unknown) => select(h), {
    getState: () => h,
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: unknown) => unknown) =>
    select({ defaultModel: null, virtualModels: [] }),
}));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ useUsableProviders: () => [] }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));
vi.mock('@/components/chat/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('./AvatarCropDialog', () => ({ AvatarButtons: () => null }));
vi.mock('./BotAvatar', () => ({ BotAvatar: () => null }));
vi.mock('./BotAbilities', () => ({ BotAbilityFields: () => null }));
vi.mock('./BotUsageCard', () => ({ BotUsageCard: () => null }));
vi.mock('./MemorySpaceList', () => ({ MemorySpaceList: () => null }));
vi.mock('./NotesEditor', () => ({ NotesEditor: () => null }));
vi.mock('./PersonaSuggest', () => ({ PersonaSuggestButton: () => null }));
vi.mock('./RoutineList', () => ({ RoutineList: () => null }));
vi.mock('@/components/chat/ModelPicker', () => ({
  MODEL_PICKER_FORM_TRIGGER_CLASS: '',
  ModelPicker: ({
    providerId,
    modelId,
    thinkingLevel,
    onSelect,
    onThinkingChange,
    onReasoningChange,
  }: {
    providerId: string;
    modelId: string;
    thinkingLevel: ThinkingLevel;
    onSelect: (providerId: string, modelId: string) => void;
    onThinkingChange: (level: ThinkingLevel) => void;
    onReasoningChange: (enabled: boolean) => void;
  }) =>
    createElement(
      'div',
      null,
      createElement('output', { 'data-engine': true }, `${providerId}/${modelId}/${thinkingLevel}`),
      createElement(
        'button',
        {
          type: 'button',
          // ModelPicker selects and clamps the target's supported depth in the same event.
          onClick: () => {
            onSelect('target-provider', 'limited-model');
            onThinkingChange('low');
          },
        },
        'Select limited model'
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onSelect('target-provider', 'ordinary-model');
            onReasoningChange(false);
          },
        },
        'Select ordinary model'
      ),
      createElement(
        'button',
        { type: 'button', onClick: () => onSelect(providerId, modelId) },
        'Select current model'
      )
    ),
}));

const bot: BotProfile = {
  id: 'member',
  name: 'UI-member',
  title: 'Design',
  scope: '',
  avatar: { color: '#7c5cff' },
  engine: { providerId: 'original-provider', modelId: 'original-model', thinkingLevel: 'high' },
  tools: 'all',
  approvalMode: 'auto-edits',
  skillIds: [],
  mcpServerIds: [],
  delegation: { canDelegateTo: 'any', acceptFrom: 'any' },
  memory: { enabled: true },
  createdAt: 1,
  updatedAt: 1,
  version: 1,
};
const chat: BotChat = {
  id: 'direct',
  kind: 'direct',
  title: '',
  members: [bot.id],
  bossBotId: null,
  workspace: { kind: 'member-home' },
  sessions: {},
  routing: { mode: 'boss', maxHops: 2, maxTurnsPerBot: 2 },
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === label
  );
  expect(found, `${label} button`).toBeDefined();
  return found!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  h.bots = [structuredClone(bot)];
  h.get.mockResolvedValue({ ok: true, bot: h.bots[0], persona: 'persona' });
  h.update.mockImplementation(async ({ draft }) => ({
    ok: true,
    bot: { ...h.bots[0], engine: draft.engine, version: 2 },
  }));
  h.upsertBot.mockImplementation((next: BotProfile) => {
    h.bots = [next];
  });
  vi.stubGlobal('electronAPI', { bots: { get: h.get, update: h.update } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(BotProfilePanel, { botId: bot.id, chat, onOpenHistory: vi.fn() }));
  });
  await act(async () => button('Abilities').click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('keeps the save actions discoverable but disabled when nothing has changed', () => {
  expect(button('Save').disabled).toBe(true);
  expect(button('Discard').disabled).toBe(true);
  expect(h.update).not.toHaveBeenCalled();
});

it('keeps the selected provider/model when thinking is clamped in the same interaction, then saves it', async () => {
  await act(async () => button('Select limited model').click());
  expect(container.querySelector('[data-engine]')?.textContent).toBe(
    'target-provider/limited-model/low'
  );
  expect(button('Save').disabled).toBe(false);
  expect(h.update).not.toHaveBeenCalled();
  await act(async () => button('Save').click());
  expect(h.update).toHaveBeenCalledWith({
    botId: bot.id,
    expectedVersion: 1,
    draft: expect.objectContaining({
      engine: { providerId: 'target-provider', modelId: 'limited-model', thinkingLevel: 'low' },
    }),
  });
  expect(button('Save').disabled).toBe(true);
});

it('discards the model and depth together without persisting the draft', async () => {
  await act(async () => button('Select limited model').click());
  await act(async () => button('Discard').click());
  expect(container.querySelector('[data-engine]')?.textContent).toBe(
    'original-provider/original-model/high'
  );
  expect(button('Save').disabled).toBe(true);
  expect(h.update).not.toHaveBeenCalled();
});

it('preserves the target identity when reasoning is disabled during selection', async () => {
  await act(async () => button('Select ordinary model').click());
  await act(async () => button('Save').click());
  expect(h.update).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({
        engine: { providerId: 'target-provider', modelId: 'ordinary-model' },
      }),
    })
  );
});

it('does not offer a write for reselecting the same model', async () => {
  await act(async () => button('Select current model').click());
  expect(button('Save').disabled).toBe(true);
  expect(h.update).not.toHaveBeenCalled();
});
