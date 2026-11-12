// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GeneratedImageSkeleton } from './GeneratedImageSkeleton';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
describe('Vetta 同款生图占位配色', () => {
  it.each([false, true])(
    '生图与改图都固定采用原版 mono light 黑白蓝色块，editing=%s',
    (editing) => {
      const box = document.createElement('div');
      box.innerHTML = renderToStaticMarkup(createElement(GeneratedImageSkeleton, { editing }));
      const colours = [...box.querySelectorAll<HTMLElement>('.imagegen-blob-ripple')].map(
        (n) => n.style.background
      );
      expect(colours).toEqual([
        'rgb(0, 0, 0)',
        'rgb(232, 232, 232)',
        'rgb(0, 0, 0)',
        'rgb(45, 98, 239)',
        'rgb(228, 228, 228)',
      ]);
      expect(box.querySelector('[role=status]')?.getAttribute('aria-label')).toBe(
        editing ? 'Editing image…' : 'Generating image…'
      );
      expect(box.textContent).toBe('Image processing');
      expect(box.querySelector('svg path[fill-rule=evenodd]')).not.toBeNull();
    }
  );
});
