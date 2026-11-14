import type { RemoteNodeStatus } from '@shared/types/nodes';
import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';
import type { StatusBarConversation } from './statusBarSummary';

const state = vi.hoisted(() => ({
  nodes: [] as RemoteNodeStatus[],
  activeNodeId: 'local',
  conversations: {} as Record<string, StatusBarConversation>,
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, args?: { count: number }) =>
      key.replace('{{count}}', String(args?.count ?? '')),
  }),
}));
vi.mock('@/stores/remoteNodes', () => ({
  useRemoteNodesStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (value: typeof state) => unknown) => select(state),
}));

const render = () => parseHTML(renderToStaticMarkup(createElement(StatusBar))).document;
const node: RemoteNodeStatus = {
  nodeId: 'remote',
  label: 'Office computer',
  relayUrl: 'wss://example.test',
  pairedAt: 1,
  connected: true,
  hostOnline: true,
};

beforeEach(() => {
  state.nodes = [];
  state.activeNodeId = 'local';
  state.conversations = {};
});

describe('图标轨上的紧凑工作台状态', () => {
  it('本机空闲时不渲染状态占位或静态宣传文案', () => {
    expect(renderToStaticMarkup(createElement(StatusBar))).toBe('');
  });

  it('同时保留全局待处理和运行中计数，不再占用全宽页脚', () => {
    state.conversations = {
      a: { status: 'running' },
      b: { spawning: true },
      c: { status: 'running', pendingApprovals: [{}] },
    };
    const document = render();
    expect(document.querySelector('footer')).toBeNull();
    expect(document.querySelector('[data-slot="status-bar"]')).toBeNull();
    expect(document.querySelector('[data-slot="workbench-status"]')).not.toBeNull();
    expect(document.querySelector('[data-status="waiting"]')?.textContent).toBe('1');
    expect(document.querySelector('[data-status="running"]')?.textContent).toBe('2');
  });

  it('远程节点在线时不重复显示节点名称和正常状态', () => {
    state.nodes = [node];
    state.activeNodeId = node.nodeId;
    expect(renderToStaticMarkup(createElement(StatusBar))).toBe('');
  });

  it.each([
    [true, 'Remote desktop is offline'],
    [false, 'Connecting…'],
  ])('远程不可用时保留常驻告警（connected=%s）', (connected, label) => {
    state.nodes = [{ ...node, hostOnline: false, connected }];
    state.activeNodeId = node.nodeId;
    const warning = render().querySelector('[data-status="remote"]');
    expect(warning?.getAttribute('aria-label')).toBe(`${node.label} · ${label}`);
  });

  it('远程节点下的后台计数明确属于本机，不冒充远程任务', () => {
    state.nodes = [node];
    state.activeNodeId = node.nodeId;
    state.conversations = { a: { status: 'running' } };
    expect(render().querySelector('[data-status="running"]')?.getAttribute('aria-label')).toBe(
      'This computer · 1 running'
    );
  });

  it('大数量视觉封顶但保留完整可访问描述', () => {
    state.conversations = Object.fromEntries(
      Array.from({ length: 120 }, (_, index) => [index, { status: 'running' }])
    );
    const running = render().querySelector('[data-status="running"]');
    expect(running?.textContent).toBe('99+');
    expect(running?.getAttribute('aria-label')).toBe('This computer · 120 running');
  });
});
