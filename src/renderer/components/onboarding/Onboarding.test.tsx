// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Onboarding } from './Onboarding';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useOverlayGuard', () => ({ useOverlayGuard: () => {} }));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ useMaterializedProviders: () => [] }));
vi.mock('@/stores/oauthCredentials', () => ({
  useOauthCredentialStore: (select: (s: object) => unknown) => select({ snapshot: {} }),
  oauthCredentialContext: () => ({}),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) =>
    select({
      setOnboarded: vi.fn(),
      virtualModels: [],
      skills: [],
      mcpServers: [],
      instructions: [],
      presets: [],
      defaultModel: null,
    }),
}));
vi.mock('../settings/AgentTypesSettings', () => ({ AgentTypeList: () => null }));
vi.mock('../settings/LocalAssetImportDialog', () => ({ LocalAssetImportDialog: () => null }));
vi.mock('../settings/LocalImportDialog', () => ({ LocalImportDialog: () => null }));
vi.mock('../settings/PresetsSettings', () => ({ PresetEditDialog: () => null }));
vi.mock('../settings/ProviderSetupWizard', () => ({ ProviderSetupWizard: () => null }));

let root: Root;
let container: HTMLDivElement;
let trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  trigger = document.createElement('button');
  trigger.textContent = 'underlying';
  container = document.createElement('div');
  document.body.append(trigger, container);
  trigger.focus();
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  trigger.remove();
  vi.unstubAllGlobals();
});

it('names a modal dialog, loops Tab in both directions, blocks background focus and restores focus', async () => {
  await act(async () => root.render(<Onboarding />));
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog?.getAttribute('aria-modal')).toBe('true');
  expect(dialog?.getAttribute('aria-label')).toBe('Welcome to 小满');
  const close = container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
  const next = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Get started'
  )!;
  expect(document.activeElement).toBe(close);
  next.focus();
  await act(async () =>
    next.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    )
  );
  expect(document.activeElement).toBe(close);
  await act(async () =>
    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
  );
  expect(document.activeElement).toBe(next);
  trigger.focus();
  expect(dialog?.contains(document.activeElement)).toBe(true);
  // AgentTypeList also opens its own existing portalled Dialog, outside Onboarding state.
  const nested = document.createElement('div');
  nested.setAttribute('role', 'dialog');
  nested.setAttribute('aria-modal', 'true');
  const nestedButton = document.createElement('button');
  nested.append(nestedButton);
  document.body.append(nested);
  try {
    nestedButton.focus();
    expect(document.activeElement).toBe(nestedButton);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    nestedButton.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  } finally {
    nested.remove();
  }
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(trigger);
});
