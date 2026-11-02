import { describe, expect, it } from 'vitest';
import { observePluginPlanEvent, PluginPlanStates } from './planPolicy';

const identity = { sessionId: 's', generation: 'g1' };
describe('插件 generation plan 策略', () => {
  it('事件接线：parent-ready 无 plan 放行，plan-state planning 拒绝', () => {
    const states = new PluginPlanStates();
    observePluginPlanEvent(states, { type: 'parent-ready', identity });
    expect(states.allows(identity)).toBe(true);
    observePluginPlanEvent(states, {
      type: 'plan-state',
      identity,
      state: { active: true, resolutions: {} },
    });
    observePluginPlanEvent(states, { type: 'parent-ready', identity });
    expect(states.allows(identity)).toBe(false);
  });
  it('snapshot 重建而非叠加，恢复 plan 和无 plan 会话', () => {
    const states = new PluginPlanStates();
    states.ready({ sessionId: 'stale', generation: 'g' });
    const other = { sessionId: 'other', generation: 'g' };
    observePluginPlanEvent(states, {
      type: 'snapshot',
      sessions: [{ identity, planState: { active: true, resolutions: {} } }, { identity: other }],
    });
    expect(states.allows({ sessionId: 'stale', generation: 'g' })).toBe(false);
    expect(states.allows(identity)).toBe(false);
    expect(states.allows(other)).toBe(true);
  });
  it.each(['parent-ended', 'parent-rejected', 'worker-exited'] as const)(
    '%s 撤销对应 generation',
    (type) => {
      const states = new PluginPlanStates();
      states.ready(identity);
      observePluginPlanEvent(states, { type, identity: { ...identity, generation: 'old' } });
      expect(states.allows(identity)).toBe(true);
      observePluginPlanEvent(states, { type, identity });
      expect(states.allows(identity)).toBe(false);
    }
  );
  it('worker-exited 无 identity 时清空全部', () => {
    const states = new PluginPlanStates();
    states.ready(identity);
    observePluginPlanEvent(states, { type: 'worker-exited' });
    expect(states.allows(identity)).toBe(false);
  });
  it('未知会话默认拒绝；parent ready 未启用 plan 时放行', () => {
    const states = new PluginPlanStates();
    expect(states.allows(identity)).toBe(false);
    states.ready(identity);
    expect(states.allows(identity)).toBe(true);
  });
  it('ready 不覆盖同代 planning/awaiting_review；旧代权限不能沿用', () => {
    const states = new PluginPlanStates();
    for (const state of [
      { active: true, resolutions: {} },
      { active: true, resolutions: {}, pending: { planId: 'p', title: 'p', text: 'p' } },
    ]) {
      states.set(identity, state);
      states.ready(identity);
      expect(states.allows(identity)).toBe(false);
    }
    const next = { ...identity, generation: 'g2' };
    expect(states.allows(next)).toBe(false);
    states.ready(next);
    expect(states.allows(next)).toBe(true);
    states.remove(identity);
    expect(states.allows(next)).toBe(true);
    states.remove(next);
    expect(states.allows(next)).toBe(false);
  });
  it('snapshot 缺少 planState 等价于 off；worker 退出全部撤销', () => {
    const states = new PluginPlanStates();
    states.set(identity, undefined);
    expect(states.allows(identity)).toBe(true);
    states.clear();
    expect(states.allows(identity)).toBe(false);
  });
});
