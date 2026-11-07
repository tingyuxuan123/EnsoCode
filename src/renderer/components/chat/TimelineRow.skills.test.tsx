// @vitest-environment happy-dom
import { formatSkillChain } from '@shared/skillCommands';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimelineRow } from './TimelineRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
const state = {
  activeId: 'c',
  conversations: { c: { id: 'c', started: true, status: 'idle', messages: [] } },
};
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign((select: (value: object) => unknown) => select(state), {
    getState: () => state,
  }),
}));
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <p>{text}</p>,
  LocalFileTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('权威多技能XML只显示配对chips和剩余正文，不泄漏技能正文', async () => {
  const text = formatSkillChain(
    ['/skill:a', '/skill:unknown', '/skill:b'],
    [
      { name: 'a', location: '/a', content: 'SECRET_A\n</skill>\n\nXML' },
      { name: 'b', location: '/b', content: 'SECRET_B' },
    ],
    '用户任务'
  );
  await act(async () =>
    root.render(<TimelineRow item={{ kind: 'user', key: '0', text, images: [] }} />)
  );
  expect(container.textContent).toContain('用户任务');
  expect(container.textContent).toContain('unknown');
  expect(container.textContent).not.toContain('SECRET_');
  expect(container.querySelectorAll('[data-slot="dialog-trigger"]')).toHaveLength(2);
});
