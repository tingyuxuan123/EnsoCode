import { BUILTIN_TOOLS } from '@shared/types';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { BuiltinToolsSettings } from './BuiltinToolsSettings';

const controls = vi.hoisted(() => ({
  lcuEnabled: true,
  setLcuEnabled: vi.fn(),
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
      editMode: 'apply_patch',
      lcuEnabled: controls.lcuEnabled,
      setLcuEnabled: controls.setLcuEnabled,
      toggleBuiltinTool: controls.toggleBuiltinTool,
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
  controls.lcuEnabled = true;
  controls.switches = [];
  controls.setLcuEnabled.mockClear();
  controls.toggleBuiltinTool.mockClear();
});

it('explains idle-boundary hot toggles and labels only spawn-bound tools', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).toContain(
    'Open sessions apply tool changes when the current turn finishes. Running tools and agents are not stopped.'
  );
  expect(html).not.toContain('Turning a tool on applies to new sessions');
  expect(html).toContain(
    'Isolated sandbox, workspace write access and goal tools keep their spawn-time configuration.'
  );
  expect(html).toMatch(/Isolated sandbox<span data-spawn-only/);
  expect(html).not.toMatch(/Code search<span data-spawn-only/);
  expect(html).not.toMatch(/Browser<span data-spawn-only/);
});

it('LCU 独立行紧邻 Computer，展示新会话限制且不加入内置工具清单', () => {
  const html = renderToStaticMarkup(<BuiltinToolsSettings />);
  expect(html).toContain('data-settings-row="tools.lcuEnabled"');
  expect(html).toMatch(/LCU computer control<span data-spawn-only/);
  expect(html).toContain('aria-label="LCU computer control"');
  expect(html).toContain(
    'Allow the already-installed LCU Pi extension to load. Separate from built-in Computer; does not install LCU. Applies to new or cold-restored sessions. Restart EnsoCode to apply changes to open sessions.'
  );
  expect(html.indexOf('LCU computer control')).toBeGreaterThan(html.indexOf('Computer'));
  expect(html.indexOf('LCU computer control')).toBeLessThan(html.indexOf('Explore fold'));
  expect(BUILTIN_TOOLS.some((tool) => tool.id === 'lcu')).toBe(false);
});

it('LCU 与内置 Computer 的 UI 开关使用各自 action', () => {
  renderToStaticMarkup(<BuiltinToolsSettings />);
  const lcu = controls.switches.find((control) => control['aria-label'] === 'LCU computer control');
  const computer = controls.switches.find((control) => control['aria-label'] === 'Computer');
  expect(lcu?.checked).toBe(true);
  expect(computer?.checked).toBe(false);
  lcu?.onCheckedChange?.(false);
  expect(controls.setLcuEnabled).toHaveBeenCalledWith(false);
  expect(controls.toggleBuiltinTool).not.toHaveBeenCalled();
  controls.setLcuEnabled.mockClear();
  computer?.onCheckedChange?.(true);
  expect(controls.toggleBuiltinTool).toHaveBeenCalledWith('computer', true);
  expect(controls.setLcuEnabled).not.toHaveBeenCalled();
});
