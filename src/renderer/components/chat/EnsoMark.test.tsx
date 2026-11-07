import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EnsoMark } from './EnsoMark';

it('uses the Eaves rain-curtain mark with an accent drop and inherited body color', () => {
  const html = renderToStaticMarkup(<EnsoMark className="custom-size" />);
  expect(html).toContain('viewBox="0 0 100 100"');
  expect(html).toContain('M12 23 Q16 31 26 32 L74 32 Q84 31 88 23');
  expect(html).toContain('M31 45 V56 M31 64 V72 M50 45 V58 M69 45 V50 M69 58 V76');
  expect(html).toContain('stroke="currentColor"');
  expect(html).toContain('fill="#2563EB"');
  expect(html).toContain('dark:fill-[#3B82F6]');
  expect(html).toContain('custom-size');
  expect(html).toContain('aria-hidden="true"');
});
