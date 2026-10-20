import { describe, expect, it } from 'vitest';
import { shouldCollapseUserQuery, USER_QUERY_MAX_HEIGHT } from './userQueryCollapse';

describe('用户消息长文折叠', () => {
  it('未超过可见高度（含 1px 余量）时不折叠', () => {
    expect(shouldCollapseUserQuery(0)).toBe(false);
    expect(shouldCollapseUserQuery(USER_QUERY_MAX_HEIGHT)).toBe(false);
    expect(shouldCollapseUserQuery(USER_QUERY_MAX_HEIGHT + 1)).toBe(false);
  });

  it('超过余量才折叠', () => {
    expect(shouldCollapseUserQuery(USER_QUERY_MAX_HEIGHT + 2)).toBe(true);
    expect(shouldCollapseUserQuery(600)).toBe(true);
  });

  it('脏测量值不折叠，避免闪出按钮', () => {
    expect(shouldCollapseUserQuery(Number.NaN)).toBe(false);
    expect(shouldCollapseUserQuery(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
