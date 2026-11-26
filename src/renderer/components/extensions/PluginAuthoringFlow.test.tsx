// @vitest-environment happy-dom

import { authoringCapabilities } from '@shared/extensionPlugins/authoringContract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginAuthoringDialog } from './PluginAuthoringDialog';
import { PluginAuthoringPane } from './PluginAuthoringPane';

const f = vi.hoisted(() => ({
  activeId: 's' as string | null,
  open: vi.fn(),
  fill: vi.fn((..._args: unknown[]) => true),
  native: {
    busy: null,
    stageAuthoringTrial: vi.fn(),
    stageAuthoringDraft: vi.fn(),
    rollbackAuthoringDraft: vi.fn(),
  },
  draft: {
    id: 'local.draft123',
    directory: 'plugin-123',
    template: 'workspace',
    hostVersion: '0.2.110',
    request: '记忆插件',
    trialId: 'local.try123',
  },
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'zh' }) }));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ activeId: f.activeId }),
    { getState: () => ({ activeId: f.activeId, conversations: { s: { projectId: 'p' } } }) }
  ),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: Object.assign(() => null, {
    getState: () => ({ projects: [{ id: 'p', path: '/project', kind: 'local', name: 'Project' }] }),
  }),
}));
vi.mock('@/stores/sidePanel', () => ({
  useSidePanelStore: { getState: () => ({ setFullscreen: vi.fn() }) },
}));
vi.mock('@/lib/sidePanelDock', () => ({
  addSidePanelPluginAuthoring: (...args: unknown[]) => f.open(...args),
  openSidePanelFile: vi.fn(),
  openSidePanelPluginView: vi.fn(),
}));
vi.mock('@/plugins/useNativePluginManager', () => ({ useNativePluginManager: () => f.native }));
vi.mock('@/plugins/NativePluginFlows', () => ({
  NativePluginFlows: () => null,
  PLUGIN_TRUST_WARNING: 'Trusted Node code, not an OS sandbox',
}));
vi.mock('@/plugins/viewBridge', () => ({ usePluginViews: () => [] }));
vi.mock('@/components/chat/composerMentionBridge', () => ({ requestFocusComposer: vi.fn() }));
vi.mock('./pluginAuthoringDraft', async () => ({
  ...(await vi.importActual<typeof import('./pluginAuthoringDraft')>('./pluginAuthoringDraft')),
  readEmptyAuthoringDraft: () => ({ rev: '1', generation: 'g' }),
  fillPluginAuthoringDraft: (...args: unknown[]) => f.fill(...args),
}));

let root: Root, container: HTMLDivElement;
let api: Record<string, ReturnType<typeof vi.fn>>;
const unverified = { state: 'unverified', detail: 'not checked' };
const inspect = () => ({
  ok: true,
  draft: f.draft,
  name: 'Notes',
  version: '0.1.0',
  sourceHash: 'a'.repeat(64),
  capabilities: authoringCapabilities('0.2.110'),
  warnings: [],
  checks: {
    static: { state: 'passed', detail: 'manifest only' },
    tests: unverified,
    runtime: unverified,
    business: unverified,
    models: unverified,
  },
  rollbackAvailable: false,
});
beforeEach(() => {
  vi.clearAllMocks();
  f.activeId = 's';
  f.fill.mockReturnValue(true);
  api = {
    authoringContext: vi.fn(async () => ({
      ok: true,
      capabilities: authoringCapabilities('0.2.110'),
      drafts: [f.draft],
    })),
    createAuthoringDraft: vi.fn(async () => ({ ok: true, draft: f.draft })),
    openAuthoringDraft: vi.fn(async () => ({ ok: true, draft: f.draft })),
    inspectAuthoringDraft: vi.fn(async () => inspect()),
    exportAuthoringDraft: vi.fn(async () => ({
      ok: true,
      name: 'notes.zip',
      sha256: 'a'.repeat(64),
    })),
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionPlugins: api },
    configurable: true,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(label)
  );
  expect(button, label).toBeTruthy();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}

it('shows actual host, recommends memory as workspace, resumes the saved identity and never auto-sends', async () => {
  await render(<PluginAuthoringDialog onClose={() => {}} onOpenConversation={() => {}} />);
  expect(document.body.textContent).toContain('0.2.110');
  expect(document.body.textContent).toContain('Resume a plugin project');
  await click('记忆插件');
  expect(api.openAuthoringDraft).toHaveBeenCalledWith('s', f.draft.id, false);
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({ id: f.draft.id, sessionId: 's' }));
  expect(f.fill).toHaveBeenCalled();
  expect(api.createAuthoringDraft).not.toHaveBeenCalled();
});
it('keeps unverified layers visible, exports separately and never auto-installs on opening', async () => {
  await render(
    <PluginAuthoringPane
      {...f.draft}
      template="workspace"
      sessionId="s"
      cwd="/project"
      projectId="p"
      prompt="original"
      filled={false}
    />
  );
  expect(container.textContent).toContain('Static manifest and capabilities');
  expect(container.textContent).toContain('Not verified');
  expect(f.native.stageAuthoringDraft).not.toHaveBeenCalled();
  expect(f.native.stageAuthoringTrial).not.toHaveBeenCalled();
  await click('Export installable ZIP');
  expect(api.exportAuthoringDraft).toHaveBeenCalledWith('s', f.draft.id);
  expect(container.textContent).toContain('notes.zip');
  await click('Review permissions and load trial');
  expect(f.native.stageAuthoringTrial).toHaveBeenCalledWith('s', f.draft.id);
  expect(f.native.stageAuthoringDraft).not.toHaveBeenCalled();
});
