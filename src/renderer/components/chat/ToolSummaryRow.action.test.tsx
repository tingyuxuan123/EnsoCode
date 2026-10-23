import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolSummaryRow } from './ToolSummaryRow';

describe('工具摘要的只读详情动作', () => {
  it('打开详情是独立动作，不伪装成折叠展开', () => {
    const html = renderToStaticMarkup(
      createElement(ToolSummaryRow, {
        kind: 'Agent',
        summary: '检查代码',
        canToggle: false,
        onActivate: () => {},
        actionLabel: '查看子代理过程',
      })
    );
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="查看子代理过程"');
    expect(html).not.toContain('aria-expanded');
  });
});
