import { afterEach, expect, it, vi } from 'vitest';
import { hasActivePluginGesture, hasPluginViewGesture } from './userGesture';

it('侧栏手势必须同时激活并聚焦该 iframe，不能蹭用输入框激活', () => {
  const frame = {};
  const input = {};
  expect(hasPluginViewGesture(frame, input, true)).toBe(false);
  expect(hasPluginViewGesture(frame, frame, true)).toBe(true);
  expect(hasPluginViewGesture(frame, frame, false)).toBe(false);
  expect(hasPluginViewGesture(null, null, true)).toBe(false);
});

afterEach(() => vi.unstubAllGlobals());
it('缺少 userActivation 或未激活时 fail closed，仅 active===true 放行', () => {
  for (const navigator of [
    {},
    { userActivation: { isActive: false } },
    { userActivation: { isActive: 'true' } },
  ]) {
    vi.stubGlobal('navigator', navigator);
    expect(hasActivePluginGesture()).toBe(false);
  }
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  expect(hasActivePluginGesture()).toBe(true);
});
