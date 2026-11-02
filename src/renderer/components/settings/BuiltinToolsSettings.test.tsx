import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BuiltinToolsSettings } from './BuiltinToolsSettings';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({
      disabledBuiltinTools: ['memory', 'computer', 'code_search'],
      subagentAllowedModes: ['task'],
      webSearchChain: [],
      editMode: 'apply_patch',
    }),
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
