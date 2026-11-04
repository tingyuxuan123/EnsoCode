import { expect, it } from 'vitest';
import { isExtensionsSessionNavigation } from './extensionNavigation';

it('协作者后台结束清掉标签时，不把它当成离开扩展页的导航', () => {
  expect(isExtensionsSessionNavigation({ id: 'parent', tab: 'child' }, { id: 'parent' })).toBe(
    false
  );
  expect(isExtensionsSessionNavigation({ id: 'parent' }, { id: 'parent', tab: 'child' })).toBe(
    false
  );
});

it('选中另一个会话或删除当前会话时返回对话视图', () => {
  expect(isExtensionsSessionNavigation({ id: 'a' }, { id: 'b' })).toBe(true);
  expect(isExtensionsSessionNavigation({ id: 'a' }, { id: null })).toBe(true);
});
