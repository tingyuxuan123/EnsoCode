import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { TimelineRow } from './TimelineRow';
import { TurnFilesContext } from './TurnFilesCard';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('@/lib/sidePanelDock', () => ({ openSidePanelFile: vi.fn() }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const element = dom.document.getElementById('root');
  if (!element) throw new Error('Missing test root');
  container = element;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('最终回复页脚', () => {
  it('正文与耗时不变、仅 turnEnd 变化时也要更新改动卡片', async () => {
    const item: Extract<TimelineItem, { kind: 'text' }> = {
      kind: 'text',
      key: '5-0',
      text: '已修改并校验',
      streaming: false,
    };
    const context = {
      conversationId: 'c',
      summaries: new Map([
        [5, { added: 1, removed: 0, files: [{ path: 'src/a.ts', added: 1, removed: 0 }] }],
      ]),
    };
    const render = (row: TimelineItem) =>
      act(async () =>
        root.render(
          createElement(
            TurnFilesContext.Provider,
            { value: context },
            createElement(TimelineRow, { item: row })
          )
        )
      );

    await render(item);
    expect(container.querySelector('[data-turn-files]')).toBeNull();
    await render({ ...item, turnEnd: true });
    expect(container.querySelector('[data-turn-file="src/a.ts"]')).not.toBeNull();
    await render({ ...item });
    expect(container.querySelector('[data-turn-files]')).toBeNull();
  });
});
