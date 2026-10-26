import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dialog 的内边距只由 DialogHeader（p-6）和 DialogPanel（px-6）提供，
 * DialogDescription 本身不带 padding。把说明文字裸放在 DialogContent 下
 * 会顶到弹窗边缘、和标题不对齐——typecheck 和单测都发现不了，只有肉眼能看出来。
 * 用静态扫描把这个错误挡住。
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

  it('keeps the padding that those slots are responsible for', () => {
    // 约定变了就要更新上面的扫描规则，别让它变成空转的测试
    const dialog = readFileSync(path.join(RENDERER, 'components/ui/dialog.tsx'), 'utf8');
    const header = dialog.slice(dialog.indexOf('function DialogHeader'));
    expect(header.slice(0, 400)).toContain('p-6');
    const panelClass = dialog.slice(dialog.indexOf('const DIALOG_PANEL_CLASS'));
    expect(panelClass.slice(0, 400)).toContain('px-6');
    const panel = dialog.slice(dialog.indexOf('function DialogPanel'));
    expect(panel.slice(0, 600)).toContain('DIALOG_PANEL_CLASS');
  });
});
