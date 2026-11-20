// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';

const { loadGraph, loadEditor } = vi.hoisted(() => ({ loadGraph: vi.fn(), loadEditor: vi.fn() }));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useColorScheme', () => ({ useCodeHighlightOptions: () => ({}) }));

vi.mock('./MemoryGraphView', () => {
  loadGraph();
  return { MemoryGraphView: () => null };
});

vi.mock('@pierre/diffs/edit', () => {
  loadEditor();
  return { Editor: class {} };
});

it('does not evaluate the graph or editor just by loading settings components', async () => {
  await import('./MemoryKnowledge');
  await import('./CodeEditor');

  expect(loadGraph).not.toHaveBeenCalled();
  expect(loadEditor).not.toHaveBeenCalled();
});
