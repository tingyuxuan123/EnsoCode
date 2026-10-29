import type {
  CompactReserveTokensReadResult,
  CompactReserveTokensResult,
} from '@shared/compactionSettings';
import { parseHTML } from 'linkedom';
import { act, type InputHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactReserveTokensSection } from './CompactReserveTokensSection';

const harness = vi.hoisted(() => ({
  read: vi.fn<() => Promise<CompactReserveTokensReadResult>>(),
  write: vi.fn<(value: number | null) => Promise<CompactReserveTokensResult>>(),
  change: undefined as InputHTMLAttributes<HTMLInputElement>['onChange'],
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./NewSessionBadge', () => ({ NewSessionBadge: () => <span>New session</span> }));
vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => {
    harness.change = props.onChange;
    return <input {...props} />;
  },
}));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', { userAgent: 'test' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(dom.window, {
    electronAPI: {
      compaction: { getReserveTokens: harness.read, setReserveTokens: harness.write },
    },
  });
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  harness.read.mockReset().mockResolvedValue({ ok: true, value: null });
  harness.write.mockReset().mockResolvedValue({ ok: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<CompactReserveTokensSection />));
async function change(value: string) {
  await act(async () =>
    harness.change?.({ target: { value } } as Parameters<NonNullable<typeof harness.change>>[0])
  );
}
async function save() {
  const button = container.querySelector('button');
  expect(button).not.toBeNull();
  await act(async () => button?.click());
}

describe('压缩预留 token 设置界面', () => {
  it('保留默认空值、显示新会话说明，初始读取不写配置', async () => {
    await render();
    expect(container.querySelector('input')?.value).toBe('');
    expect(container.querySelector('input')?.placeholder).toBe('16384');
    expect(container.textContent).toContain('New session');
    expect(container.textContent).toContain('Larger values compact earlier');
    expect(harness.write).not.toHaveBeenCalled();
  });
  it('保存合法值、清空删除覆盖，错误输入不发 IPC', async () => {
    await render();
    await change('32768');
    await save();
    expect(harness.write).toHaveBeenLastCalledWith(32768);
    await change('');
    await save();
    expect(harness.write).toHaveBeenLastCalledWith(null);
    await change('1e4');
    await save();
    expect(harness.write).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('保存失败保留草稿供重试，不误记为已保存', async () => {
    harness.write.mockResolvedValueOnce({ ok: false, error: 'locked' });
    await render();
    await change('20000');
    await save();
    expect(container.querySelector('input')?.value).toBe('20000');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('busy');
    await save();
    expect(harness.write).toHaveBeenCalledTimes(2);
  });
  it('读取失败或拒绝不会把未读到的设置当默认并覆盖', async () => {
    harness.read.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('input')?.disabled).toBe(true);
    expect(harness.write).not.toHaveBeenCalled();
  });
  it('保存未完成前禁用编辑并拒绝重复提交', async () => {
    let settle!: (result: CompactReserveTokensResult) => void;
    harness.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    await render();
    await change('20000');
    await save();
    expect(container.querySelector('input')?.disabled).toBe(true);
    await save();
    expect(harness.write).toHaveBeenCalledTimes(1);
    await act(async () => settle({ ok: true }));
    expect(container.querySelector('input')?.disabled).toBe(false);
  });
  it('读取失败后可在原设置页重试，读成功前不写盘', async () => {
    harness.read.mockResolvedValueOnce({ ok: false, error: 'locked' });
    await render();
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(harness.read).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input')?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(harness.write).not.toHaveBeenCalled();
  });
});
