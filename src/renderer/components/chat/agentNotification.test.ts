import { describe, expect, it } from 'vitest';
import { parseAgentNotification } from './agentNotification';

const header = 'Subagent "检查代码" (agentId agent-1, runId run-1) succeeded after 3.5s.';
const usage = '<usage>subagent_tokens: 1300\ntool_uses: 2\nduration_ms: 3500</usage>';
const hint = 'Use subagent report with runId run-1 for the full result.';
const report = '## 检查结果\n\n- 已完成 **验证**\n\n```ts\nconst ok = true;\n```';
const notice = (body = report) => [header, body, usage, hint].join('\n');

describe('子代理完成通知的只读展示投影', () => {
  it('保留 Markdown 报告，把终态用量与模型操作提示从正文分离', () => {
    expect(parseAgentNotification(notice())).toEqual([
      { header, report, usage: { tokens: 1300, toolUses: 2, durationMs: 3500 } },
    ]);
  });

  it('支持合批、Windows 换行和 coworker 继续提示', () => {
    const second = notice('失败原因：权限不足')
      .replaceAll('agent-1', 'agent-2')
      .replaceAll('run-1', 'run-2')
      .replace('succeeded', 'failed');
    const text = `${notice()} To continue this coworker, use subagent send with agentId agent-1.\n\n---\n\n${second}`;
    expect(parseAgentNotification(text.replaceAll('\n', '\r\n'))).toMatchObject([
      { report },
      { report: '失败原因：权限不足', usage: { tokens: 1300 } },
    ]);
  });

  it('正文中的 usage 样例、分隔线和提示原文不能被当作尾部元数据删除', () => {
    const body = `说明：\n\n${usage}\n\n---\n\n${hint}\n\n以上都属于报告。`;
    expect(parseAgentNotification(notice(body))?.[0].report).toBe(body);
  });

  it('未知或损坏格式退回原文，不静默丢弃内容或伪造用量', () => {
    for (const text of [
      '',
      '普通用户消息',
      'Background task task-1 finished (exit 0, ran 2s).',
      notice().replace('duration_ms: 3500', 'duration_ms: -1'),
      notice().replace('subagent_tokens: 1300', 'subagent_tokens: 999999999999999999999'),
      notice().replace(hint, 'Use subagent report with runId unrelated for the full result.'),
      `${notice()}\n额外内容不能丢掉`,
    ]) {
      expect(parseAgentNotification(text)).toBeNull();
    }
  });

  it('零用量与没有报告正文的失败通知仍可展示', () => {
    expect(
      parseAgentNotification(
        notice('').replace('1300', '0').replace('tool_uses: 2', 'tool_uses: 0')
      )
    ).toMatchObject([{ report: '', usage: { tokens: 0, toolUses: 0 } }]);
  });
});
