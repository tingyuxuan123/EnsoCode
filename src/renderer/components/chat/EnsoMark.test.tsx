import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EnsoMark } from './EnsoMark';

it('uses the supplied Collabra logo without changing the callers’ sizing or accessibility', () => {
  const html = renderToStaticMarkup(<EnsoMark className="custom-size" />);
  expect(html).toContain('<img');
  expect(html).toContain('brand-mark.png');
  expect(html).toContain('alt=""');
  expect(html).not.toContain('<path');
  expect(html).toContain('custom-size');
  expect(html).toContain('aria-hidden="true"');
});
