import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { BuiltinToolsSettings } from './BuiltinToolsSettings';

const controls = vi.hoisted(() => ({
  designEnabled: true,
  openLinksInBuiltinBrowser: true,
  setOpenLinksInBuiltinBrowser: vi.fn(),
  setDesignEnabled: vi.fn(),
  toggleBuiltinTool: vi.fn(),
  switches: [] as Array<{
    checked?: boolean;
    'aria-label'?: string;
    onCheckedChange?: (checked: boolean) => void;
  }>,
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({
      disabledBuiltinTools: ['memory', 'computer', 'code_search'],
      subagentAllowedModes: ['task'],
      webSearchChain: [],
      providers: [],
      imageGeneration: { textToImage: null, imageToImage: null },
      editMode: 'apply_patch',
      designEnabled: controls.designEnabled,
      setDesignEnabled: controls.setDesignEnabled,
      toggleBuiltinTool: controls.toggleBuiltinTool,
      openLinksInBuiltinBrowser: controls.openLinksInBuiltinBrowser,
      setOpenLinksInBuiltinBrowser: controls.setOpenLinksInBuiltinBrowser,
    }),
}));
vi.mock('@/components/ui/switch', () => ({
  Switch: (props: (typeof controls.switches)[number]) => {
    controls.switches.push(props);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props['aria-label']}
      />
    );
  },
}));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ useMaterializedProviders: () => [] }));
vi.mock('./OccupancyMark', () => ({
  useOccupancyRows: () => ({ rows: {}, pending: false }),
  enabledOccupancyTotal: () => 0,
  OccupancyEnabledTotal: () => null,
  OccupancyMark: () => null,
}));
vi.mock('./CodeSearchSettings', () => ({ CodeSearchSettings: () => null }));
vi.mock('./NewSessionBadge', () => ({
  NewSessionBadge: ({ note }: { note?: string }) => (
    <span data-spawn-only="true">{note ?? 'New sessions only'}</span>
  ),
}));
vi.mock('@/components/chat/ModelPicker', () => ({ ModelPicker: () => null }));

beforeEach(() => {
  controls.openLinksInBuiltinBrowser = true;
  controls.setOpenLinksInBuiltinBrowser.mockClear();
  controls.switches = [];
  controls.setDesignEnabled.mockClear();
  controls.toggleBuiltinTool.mockClear();
});

it('explains idle-boundary hot toggles and labels only spawn-bound tools', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).toContain(
    'Open sessions apply tool changes when the current turn finishes. Running tools and agents are not stopped.'
  );
  expect(html).not.toContain('Turning a tool on applies to new sessions');
  expect(html).toContain(
    'Script orchestration, workspace write access and goal tools keep their spawn-time configuration.'
  );
  expect(html).toMatch(/Script orchestration<span data-spawn-only/);
  expect(html).not.toContain('Isolated sandbox');
  expect(html).not.toMatch(/Code search<span data-spawn-only/);
  expect(html).not.toMatch(/Browser<span data-spawn-only/);
});

it('script orchestration keeps the persisted tool id when toggled', () => {
  renderToStaticMarkup(<BuiltinToolsSettings />);
  const script = controls.switches.find(
    (control) => control['aria-label'] === 'Script orchestration'
  );
  expect(script?.checked).toBe(true);
  script?.onCheckedChange?.(false);
  expect(controls.toggleBuiltinTool).toHaveBeenCalledWith('isolated_sandbox', false);
});

it('no longer lists the built-in long-term memory tool', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).not.toContain('Long-term memory');
});

it('聊天链接偏好独立于 browser 工具开关，并解释 Ctrl/Cmd 外部打开', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).toContain('data-settings-row="tools.openLinksInBuiltinBrowser"');
  expect(html).toContain('Ctrl/Cmd-click uses your system browser.');
  const links = controls.switches.find(
    (control) => control['aria-label'] === 'Open chat links in built-in browser'
  );
  expect(links?.checked).toBe(true);
  links?.onCheckedChange?.(false);
  expect(controls.setOpenLinksInBuiltinBrowser).toHaveBeenCalledWith(false);
  expect(controls.toggleBuiltinTool).not.toHaveBeenCalled();
});

it('移除 LCU 设置入口，保留内置 Computer 开关', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).not.toContain('data-settings-row="tools.lcuEnabled"');
  expect(html).not.toContain('LCU computer control');
  const computer = controls.switches.find((control) => control['aria-label'] === 'Computer');
  expect(computer?.checked).toBe(false);
  computer?.onCheckedChange?.(true);
  expect(controls.toggleBuiltinTool).toHaveBeenCalledWith('computer', true);
});

it('design has one independent device setting row, with no duplicate generic builtin toggle', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).toContain('data-settings-row="tools.designEnabled"');
  expect(html).toContain('Design (UI design canvas)');
  const design = controls.switches.find(
    (control) => control['aria-label'] === 'Design (UI design canvas)'
  );
  expect(design?.checked).toBe(true);
  design?.onCheckedChange?.(false);
  expect(controls.setDesignEnabled).toHaveBeenCalledWith(false);
  expect(controls.switches.filter((control) => control['aria-label'] === 'Design')).toHaveLength(0);
  expect(controls.toggleBuiltinTool).not.toHaveBeenCalled();
});
