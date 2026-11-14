// @vitest-environment happy-dom
import type { RemoteNodeStatus } from '@shared/types/nodes';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSwitcher } from './NodeSwitcher';

const state = vi.hoisted(() => ({
  nodes: [] as RemoteNodeStatus[],
  activeNodeId: 'local',
  switchNode: vi.fn(),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/remoteNodes', () => ({
  useRemoteNodesStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock('./PairNodeDialog', () => ({ PairNodeDialog: () => null }));

let container: HTMLDivElement;
let root: Root;
const trigger = () => container.querySelector<HTMLButtonElement>('[data-slot="node-switcher"]');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.nodes = [];
  state.activeNodeId = 'local';
  state.switchNode.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('底部节点切换入口', () => {
  it('入口给出当前节点和本机数据说明，说明不占常驻底栏', async () => {
    await act(async () => root.render(<NodeSwitcher />));
    expect(trigger()?.getAttribute('aria-label')).toBe('This computer · Switch node');
    expect(trigger()?.title).toContain('Data stays on this computer');
    expect(container.textContent).not.toContain('Data stays on this computer');
    await act(async () => trigger()?.click());
    expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
      'Data stays on this computer'
    );
  });

  it('长远程名称保留完整说明和连接状态，并可切回本机', async () => {
    const label = 'Office computer with a long name';
    state.nodes = [
      {
        nodeId: 'remote',
        label,
        relayUrl: 'wss://example.test',
        pairedAt: 1,
        connected: true,
        hostOnline: false,
      },
    ];
    state.activeNodeId = 'remote';
    await act(async () => root.render(<NodeSwitcher />));
    expect(trigger()?.getAttribute('aria-label')).toBe(`${label} · Switch node`);
    expect(trigger()?.title).toContain('Remote desktop is offline');
    expect(trigger()?.querySelector('[aria-label="Remote desktop is offline"]')).not.toBeNull();
    await act(async () => trigger()?.click());
    const local = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-popup"] button'),
    ].find((button) => button.textContent?.includes('This computer'));
    expect(local).toBeDefined();
    await act(async () => local?.click());
    expect(state.switchNode).toHaveBeenCalledWith('local');
  });
});
