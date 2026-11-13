import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { goalSteps } from './goalSteps';
import type { TimelineMessage } from './reducer';

const goal = { text: '完成注册\n以及登录', autoTurns: 2 };
const message = (role: string, text: string, timestamp?: number): ProjectedMessage => ({
  role,
  content: [{ type: 'text', text }],
  timestamp,
});
const prompt = (kind: 'start' | 'resume' | 'auto', text = goal.text, timestamp?: number) =>
  message(
    'user',
    `<goal-continuation>\nSession goal${kind === 'resume' ? ' resumed' : ''}: ${text}\n${
      kind === 'start'
        ? 'Work toward this goal autonomously. When done call goal_complete with evidence;'
        : 'Continue working toward it. If it is genuinely done, call goal_complete with evidence;'
    }\n</goal-continuation>`,
    timestamp
  );

describe('目标的实际执行轮次', () => {
  it('展示启动与自动轮次的最终回复和工具操作，不生成剩余的 25 项', () => {
    const messages: TimelineMessage[] = [
      prompt('start'),
      message('assistant', '先检查接口'),
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'r', name: 'read', arguments: { path: 'src/auth.ts' } }],
      },
      message('toolResult', '文件内容'),
      message('assistant', '已确认注册接口'),
      prompt('auto'),
      message('assistant', '已实现登录'),
      { ...prompt('auto'), optimistic: true },
    ];
    expect(goalSteps(messages, goal, 'running')).toMatchObject([
      {
        kind: 'start',
        output: '已确认注册接口',
        tools: [{ name: 'read', arguments: '{"path":"src/auth.ts"}' }],
        status: 'ended',
      },
      { kind: 'auto', number: 1, output: '已实现登录', status: 'ended' },
      { kind: 'auto', number: 2, output: '', status: 'pending' },
    ]);
  });

  it('工具结束不等于整轮结束，仍在运行时保留运行态', () => {
    expect(
      goalSteps([prompt('auto'), message('assistant', '测试中')], goal, 'running')
    ).toMatchObject([{ number: 2, status: 'running', output: '测试中' }]);
  });

  it('尾窗缺少早期轮次时按实际计数编号，保留绝对消息下标', () => {
    expect(
      goalSteps(
        [prompt('auto'), message('assistant', '第十轮')],
        { ...goal, autoTurns: 10 },
        'idle',
        80
      )
    ).toMatchObject([{ number: 10, index: 80, status: 'ended' }]);
  });

  it('恢复后轮数重置，但保留之前的真实记录', () => {
    const steps = goalSteps(
      [prompt('start'), prompt('auto'), prompt('auto'), prompt('resume'), prompt('auto')],
      { ...goal, autoTurns: 1 },
      'idle'
    );
    expect(steps.map((step) => [step.kind, step.number])).toEqual([
      ['start', undefined],
      ['auto', 1],
      ['auto', 2],
      ['resume', undefined],
      ['auto', 1],
    ]);
  });

  it('不把普通对话、其他目标、assistant 中引用的提示词混入步骤', () => {
    const steps = goalSteps(
      [
        { ...prompt('start'), role: 'assistant' },
        prompt('start', '别的目标'),
        message('assistant', '别的结果'),
        prompt('start'),
        message('assistant', '目标结果'),
        message('user', '普通问题'),
        message('assistant', '普通回答'),
      ],
      goal,
      'running'
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ output: '目标结果', status: 'ended' });
  });

  it('同名新目标不串入旧记录，旧数据缺少时间时取最近一次启动', () => {
    const messages = [
      prompt('start', goal.text, 10),
      message('assistant', '旧记录'),
      prompt('auto', goal.text, 30),
    ];
    expect(goalSteps(messages, { ...goal, createdAt: 20 }, 'idle')).toHaveLength(1);
    expect(
      goalSteps([prompt('start'), message('assistant', '旧记录'), prompt('start')], goal, 'idle')
    ).toMatchObject([{ kind: 'start', output: '' }]);
  });

  it('拒收的回显不伪造步骤，失败轮次不标为完成', () => {
    expect(
      goalSteps([{ ...prompt('auto'), optimistic: true, deliveryRejected: true }], goal, 'failed')
    ).toEqual([]);
    expect(
      goalSteps([prompt('auto'), message('assistant', '连接失败')], goal, 'failed')
    ).toMatchObject([{ status: 'failed' }]);
  });
});
