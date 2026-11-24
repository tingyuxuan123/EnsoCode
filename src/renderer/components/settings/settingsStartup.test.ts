// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';

const { loadEditor } = vi.hoisted(() => ({ loadEditor: vi.fn() }));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useColorScheme', () => ({ useCodeHighlightOptions: () => ({}) }));

vi.mock('@pierre/diffs/edit', () => {
  loadEditor();
  return { Editor: class {} };
});

it('does not evaluate the editor just by loading its settings wrapper', async () => {
  await import('./CodeEditor');

  expect(loadEditor).not.toHaveBeenCalled();
});
