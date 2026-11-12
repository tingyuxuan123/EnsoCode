import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EavesWorkingIcon } from './EavesWorkingIcon';

const render = () => renderToStaticMarkup(createElement(EavesWorkingIcon));

describe('EavesWorkingIcon', () => {
  it('renders the accessible Collabra logo without changing the 22px footer footprint', () => {
    const html = render();
    expect(html).toContain('<img');
    expect(html).toContain('brand-mark.png');
    expect(html).toContain('alt="Collabra"');
    expect(html).toContain('size-[calc(22rem/14)] shrink-0');
    expect(html).not.toContain('<path');
    expect(html).not.toContain('animate-ping');
  });

  it('leaves the new artwork static rather than retaining old rain-curtain animations', () => {
    expect(render()).not.toContain('animate-');
  });
});
