import type { UpdateStatus } from '@shared/types/updater';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ status: null as UpdateStatus | null }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: vi.fn(),
  useState: (initial: unknown) => [initial === null ? state.status : initial, vi.fn()],
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { UpdateBanner } from './UpdateBanner';

describe('UpdateBanner', () => {
  it('安装失败显示具体错误并移除重启动作', () => {
    state.status = { status: 'error', error: 'Code signature verification failed' };
    const html = renderToStaticMarkup(<UpdateBanner />);
    expect(html).toContain('Code signature verification failed');
    expect(html).not.toContain('Restart to update');
  });
});
