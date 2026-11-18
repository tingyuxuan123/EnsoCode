import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PairScreen } from './PairScreen';

/** 配对页是能独立打开的入口：品牌名和应用图标都直接写在页面上。 */
it('配对页用对外品牌「CodeKiln」与应用图标，不再画内联旧 logo', () => {
  const html = renderToStaticMarkup(createElement(PairScreen, { onPaired: () => {} }));
  expect(html).toContain('CodeKiln');
  expect(html).toContain('src="/icons/logo-192.png"');
});

/**
 * 设计稿只有「扫码」和「粘贴 codekiln:// 链接」两条路：没有六位数字配对码，
 * 文案照抄 `collabra-pwa.vetd/frames/pair.tsx`。
 */
it('配对页是晨光大字 + 三步说明 + 粘贴链接 + 扫码，没有数字配对码', () => {
  const html = renderToStaticMarkup(createElement(PairScreen, { onPaired: () => {} }));
  expect(html).toContain('phone-dawn');
  expect(html).toContain('第二块屏幕');
  expect(html).toContain('phone-greet');
  expect(html).toContain('桌面端「设置 → 手机」→ 允许连入');
  expect(html).toContain('粘贴配对链接');
  expect(html).toContain('codekiln://pair?relay=…&amp;pk=…');
  expect(html).toContain('扫描二维码');
  expect(html).not.toMatch(/配对码输入|\d{6}/);
});
