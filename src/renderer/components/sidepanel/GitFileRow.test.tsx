import type { GitFile } from '@shared/types/git';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GitFileRow } from './GitFileRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const render = (file: GitFile) =>
  renderToStaticMarkup(createElement(GitFileRow, { file, selected: false, onSelect: () => {} }));

describe('GitFileRow', () => {
  it('文件行用 Material Icon Theme 的类型图标，而不是通用文件字形', () => {
    const html = render({ path: 'src/renderer/styles/kettuLight.css', status: 'modified' });
    expect(html).toMatch(/<img[^>]+css\.svg/);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it('状态靠字母与颜色表达，不靠给类型图标染色', () => {
    const html = render({ path: 'src/shared/theme/types.ts', status: 'untracked' });
    expect(html).toMatch(/<img[^>]+typescript\.svg/);
    expect(html).toContain('text-success');
    expect(html).not.toMatch(/<img[^>]+text-(success|destructive|info|warning)/);
  });

  it('仍然给出文件名、目录与状态字母', () => {
    const html = render({ path: 'src/shared/theme/types.ts', status: 'deleted' });
    expect(html).toContain('types.ts');
    expect(html).toContain('src/shared/theme/');
    expect(html).toContain('>D<');
    expect(html).toContain('deleted');
  });
});
