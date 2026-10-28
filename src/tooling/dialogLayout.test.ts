import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
} from '@/components/ui/dialog';

/**
 * Dialog 的像素内边距由 Header / Panel / Footer 提供；Description 和滚动包装层
 * 不重复提供 padding。静态扫描拦截绕过这些布局 slot 的裸内容，渲染断言锁定职责。
 */

const RENDERER = path.resolve(__dirname, '../renderer');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('dialog layout conventions', () => {
  it('never puts bare content right after DialogHeader', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(RENDERER)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('DialogContent')) continue;
      const re = /<\/DialogHeader>\s*\n\s*<(p|div|span|ul|ol|table)\b/g;
      for (const match of source.matchAll(re)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(
          `${path.relative(RENDERER, file)}:${line} <${match[1]}> should be DialogPanel or DialogDescription inside DialogHeader`
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each([false, true])('assigns pixel padding to each layout slot (bare panel: %s)', (bare) => {
    const markup = renderToStaticMarkup(
      createElement(
        Dialog,
        { open: true },
        createElement(DialogHeader, null, createElement(DialogDescription, null, 'Description')),
        createElement(DialogPanel, { bare }, 'Body'),
        createElement(DialogFooter, null, 'Actions')
      )
    );
    const { document } = parseHTML(markup);
    const slot = (name: string) => {
      const element = document.querySelector(`[data-slot="dialog-${name}"]`);
      expect(element, `Missing dialog-${name}`).not.toBeNull();
      return element as HTMLElement;
    };
    const paddingClasses = (element: Element) =>
      element.className.split(/\s+/).filter((token) => /^p[xytrblse]?-/.test(token));

    expect(paddingClasses(slot('header'))).toEqual(['px-[20px]', 'py-[16px]', 'pr-[48px]']);
    expect(paddingClasses(slot('panel'))).toEqual(['px-[20px]', 'py-[16px]']);
    expect(slot('panel').className).toContain(
      'in-[[data-slot=dialog-popup]:not(:has([data-slot=dialog-footer].border-t))]:pb-[20px]'
    );
    expect(paddingClasses(slot('footer'))).toEqual(['px-[20px]', 'py-[12px]']);
    expect(paddingClasses(slot('description'))).toEqual([]);

    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
    if (bare) {
      expect(viewport).toBeNull();
    } else {
      expect(viewport).not.toBeNull();
      expect(paddingClasses(viewport as Element)).toEqual([]);
      expect(paddingClasses(viewport?.parentElement as Element)).toEqual([]);
    }
  });
});
