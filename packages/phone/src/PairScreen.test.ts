import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PairScreen } from './PairScreen';

/** 配对页是能独立打开的入口：品牌名和头像都直接写在页面上。 */
it('配对页用对外品牌「Collabra」与应用图标，不再画内联旧 logo', () => {
  const html = renderToStaticMarkup(createElement(PairScreen, { onPaired: () => {} }));
  expect(html).toContain('连接到 Collabra');
  expect(html).toContain('src="/icons/logo-192.png"');
  expect(html).toContain('alt="Collabra"');
});
