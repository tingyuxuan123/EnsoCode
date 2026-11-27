import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProviderMark } from './ProviderMark';

describe('ProviderMark 渲染', () => {
  it('彩色官方标用 <img>，单色标用 mask 染色', () => {
    const color = renderToStaticMarkup(<ProviderMark id="deepseek" className="h-4 w-4" />);
    expect(color).toContain('<img');
    expect(color).toContain('object-contain');

    const mono = renderToStaticMarkup(<ProviderMark id="magpie" className="h-4 w-4" />);
    expect(mono).not.toContain('<img');
    expect(mono).toContain('mask-image');
    expect(mono).toContain('bg-current');
  });

  it('没有资源的厂商走内联 path，认不出的用字母', () => {
    const path = renderToStaticMarkup(<ProviderMark id="github-copilot" className="h-4 w-4" />);
    expect(path).toContain('<svg');
    expect(path).toContain('fill-current');

    const letter = renderToStaticMarkup(<ProviderMark id="acme-labs" label="Acme Labs" />);
    expect(letter).toContain('>A</span>');
  });

  it('Custom 不画标', () => {
    expect(renderToStaticMarkup(<ProviderMark id="__custom" />)).toBe('');
  });
});
