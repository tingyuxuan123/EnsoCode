import type { AskRequestInfo } from '@shared/types/agent';
import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskBar } from './AskBar';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => `translated:${key}` }) }));
vi.mock('./RequestCountdown', () => ({
  RequestCountdown: () => null,
  useRemainingMs: () => undefined,
}));

let root: Root;
let container: HTMLElement;
const onAnswer = vi.fn();
const selection = { requestId: 'q', question: 'Pick', options: [' a ', 'b'], selectionOnly: true };

beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  onAnswer.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = async (ask: AskRequestInfo) => {
  await act(async () => root.render(<AskBar asks={[ask]} onAnswer={onAnswer} />));
};
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (entry) => entry.textContent === label
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
};

describe('AskBar selectionOnly', () => {
  it('不自动选择，不显示自由输入，保留选择标签空格', async () => {
    await render(selection);
    expect(container.querySelector('input')).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
    await click(' a ');
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('q', ' a ');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });
  it('翻译后的取消按钮发送空字符串', async () => {
    await render(selection);
    await click('translated:Cancel');
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('q', '');
  });
  it('普通问题仍有输入框且快捷回答保持原先去空格行为', async () => {
    await render({ ...selection, selectionOnly: false });
    expect(container.querySelector('input')).not.toBeNull();
    expect(container.textContent).not.toContain('translated:Cancel');
    await click(' a ');
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('q', 'a');
  });
});
