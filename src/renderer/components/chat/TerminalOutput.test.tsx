import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TerminalOutput } from './TerminalOutput';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (text: string) => `translated:${text}` }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) =>
    select({ theme: 'dark', terminalTheme: 'default', terminalFontFamily: 'monospace' }),
}));
vi.mock('@/lib/terminalSurface', () => ({
  matchTerminalBackground: () => '#000',
  readAppPanelColor: () => '#000',
}));

describe('Shell失败展示', () => {
  it('失败标签和下一步经过i18n，仍显示原命令输出且不添加重试按钮', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalOutput, {
        command: 'original command',
        output: 'kept output',
        failure: { kind: 'not_found', exitCode: 127 },
      })
    );
    expect(html).toContain('original command');
    expect(html).toContain('kept output');
    expect(html).toContain('translated:Program not found');
    expect(html).toContain('(exit 127)');
    expect(html).toContain('translated:Next');
    expect(html).not.toContain('<button');
  });
  it('成功输出中的错误示例不显示失败状态', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalOutput, {
        command: 'echo example',
        output: 'command not found; timeout:10',
      })
    );
    expect(html).not.toContain('data-slot="shell-failure"');
  });
});
