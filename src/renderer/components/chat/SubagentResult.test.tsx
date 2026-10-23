import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatDuration } from '@/stores/sessions/stats';
import { SubagentResult } from './SubagentResult';
import type { SubagentReceiptView } from './subagentReceipt';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      `[${key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name]))}]`,
  }),
}));
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('div', { 'data-md': '' }, text),
}));

const render = (view: SubagentReceiptView, titles?: Record<string, string>) =>
  renderToStaticMarkup(createElement(SubagentResult, { view, titles }));

const report = (over: Partial<Extract<SubagentReceiptView, { kind: 'report' }>> = {}) =>
  render({
    kind: 'report',
    head: '',
    text: 'fake-ok',
    value: null,
    error: null,
    runs: [{ agentId: 'a', runId: 'r1', status: 'succeeded', durationMs: 12000 }],
    info: '{\n  "run": {\n    "runId": "r1"\n  }\n}',
    ...over,
  });

describe('SubagentResult', () => {
  it('仅可靠关联的目标有查看过程按钮，多目标各自保留入口', () => {
    const html = renderToStaticMarkup(
      createElement(SubagentResult, {
        view: {
          kind: 'list',
          head: '',
          info: '{}',
          runs: [
            { agentId: 'a', runId: 'r1', status: 'running', durationMs: null },
            { agentId: 'unknown', runId: 'r2', status: 'closed', durationMs: null },
          ],
        },
        onOpenAgent: () => {},
        openableAgentIds: new Set(['a']),
      })
    );
    expect(html.match(/\[View process\]/g)).toHaveLength(1);
    expect(html).toContain('data-subagent-open="a"');
    expect(html).not.toContain('data-subagent-open="unknown"');
  });
  it('查看报告：回答按 Markdown 放最前，下面一行状态与用时，运行信息收在折叠里', () => {
    const html = report();
    expect(html).toContain('<div data-md="">fake-ok</div>');
    expect(html).toContain('[succeeded]');
    expect(html).toContain(`[took ${formatDuration(12000)}]`);
    expect(html).toContain('[Run info]');
    expect(html.indexOf('fake-ok')).toBeLessThan(html.indexOf('<details'));
    expect(html.indexOf('runId')).toBeGreaterThan(html.indexOf('<details'));
  });

  it('失败原因醒目显示；结构化结果按 JSON 代码块交给 Markdown', () => {
    const html = report({
      text: null,
      value: '{\n  "ok": true\n}',
      error: 'boom',
      runs: [{ agentId: 'a', runId: 'r1', status: 'failed', durationMs: 500 }],
    });
    expect(html).toMatch(/class="[^"]*text-destructive[^"]*">boom</);
    expect(html).toContain('```json\n{\n  &quot;ok&quot;: true\n}\n```');
    expect(html).toContain('[failed]');
  });

  it('等待：每个子代理一行并带上名字，认不出的只显示状态；超时给出说明', () => {
    const unknown = 'c39dfb22-9f2c-432e-a826-99cde1491d88';
    const html = render(
      {
        kind: 'wait',
        head: '',
        timedOut: true,
        interrupted: false,
        runs: [
          { agentId: 'a', runId: 'r1', status: 'succeeded', durationMs: 3000 },
          { agentId: 'b', runId: 'r2', status: 'running', durationMs: null },
          { agentId: unknown, runId: 'r9', status: 'awaiting_input', durationMs: null },
        ],
        info: '{}',
      },
      { a: '子代理连通性测试', b: 'reviewer' }
    );
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain('子代理连通性测试');
    expect(html).toContain('reviewer');
    expect(html).toContain('[running]');
    expect(html).toContain('[awaiting input]');
    expect(html).not.toContain(unknown);
    expect(html).toContain('[Timed out; unfinished agents keep running]');
    expect(html).not.toContain('[Wait was interrupted]');
  });

  it('未知状态原样显示；捎带的系统提醒照常显示在后面', () => {
    const html = render({
      kind: 'wait',
      head: '<system-reminder>后台任务已结束</system-reminder>',
      timedOut: false,
      interrupted: true,
      runs: [{ agentId: 'a', runId: 'r1', status: 'paused', durationMs: null }],
      info: '{}',
    });
    expect(html).toContain('>paused<');
    expect(html).toContain('[Wait was interrupted]');
    expect(html).toContain('&lt;system-reminder&gt;后台任务已结束');
    expect(html.indexOf('system-reminder')).toBeGreaterThan(html.indexOf('</details>'));
  });

  it('spawn 回执没有要单列的内容，只有收起的运行信息', () => {
    const html = render({ kind: 'receipt', head: '', runs: [], info: '{"runId": "r1"}' });
    expect(html).not.toContain('<ul');
    expect(html).toContain('[Run info]');
    expect(html.indexOf('runId')).toBeGreaterThan(html.indexOf('<details'));
  });

  it('列出全部：每个子代理一行带名字，子代理状态照样翻译；一个都没有时直接说明', () => {
    const html = render(
      {
        kind: 'list',
        head: '',
        runs: [
          { agentId: 'a', runId: 'r1', status: 'succeeded', durationMs: 3000 },
          { agentId: 'b', runId: '', status: 'ready', durationMs: null },
          { agentId: 'c', runId: '', status: 'closed', durationMs: null },
          { agentId: 'd', runId: '', status: 'parked', durationMs: null },
          { agentId: 'e', runId: '', status: 'creating', durationMs: null },
        ],
        info: '{}',
      },
      { a: 'reviewer', b: '无名协作者' }
    );
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(html).toContain('reviewer');
    expect(html).toContain('无名协作者');
    for (const label of ['[succeeded]', '[idle]', '[closed]', '[parked]', '[creating]']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('[No agents]');

    const empty = render({ kind: 'list', head: '', runs: [], info: '{"agents": []}' });
    expect(empty).not.toContain('<ul');
    expect(empty).toContain('[No agents]');
  });
});
