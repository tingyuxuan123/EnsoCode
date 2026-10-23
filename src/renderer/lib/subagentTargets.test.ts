import type { AgentRunProgress } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { resolveSubagentTarget, selectSubagentDirectory } from './subagentTargets';

const child = (parentId = 'p', agentInstanceId = 'agent') => ({
  parentId,
  title: 'Same title',
  createdAt: 1,
  status: 'running',
  child: {
    parentId,
    agentInstanceId,
    agentInstanceName: 'Scout',
    dispatchOrigin: 'agent-tool',
    mode: 'task',
  },
});

describe('subagent targets', () => {
  it('来源只取 dispatchOrigin，不根据名字或派发辅助字段猜测', () => {
    for (const origin of ['manual', 'agent-tool', 'typed-mention']) {
      const c = {
        ...child(),
        mentionDispatch: true,
        child: { ...child().child, dispatchOrigin: origin },
      };
      expect(selectSubagentDirectory({ p: {}, c }, 'p')[0]).toMatchObject({
        origin,
        closed: false,
        canOpenConversation: false,
      });
    }
  });

  it('同一持久协作者多轮结束仍可交互，不把 Run 终态当实例关闭', () => {
    const c = { ...child(), status: 'idle', child: { ...child().child, mode: 'coworker' } };
    for (const status of ['succeeded', 'failed', 'cancelled', 'interrupted']) {
      const entries = selectSubagentDirectory(
        { p: { coworkerIds: ['c'] }, c: { ...c, lastSubagentRun: { runId: status, status } } },
        'p'
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        status,
        ended: true,
        closed: false,
        canOpenConversation: true,
      });
    }
  });

  it('持久协作者须在直属普通 root 成员集合中才可打开会话', () => {
    const c = { ...child(), child: { ...child().child, mode: 'coworker' } };
    const parent = { coworkerIds: ['c'] };
    expect(selectSubagentDirectory({ p: parent, c }, 'p')[0].canOpenConversation).toBe(true);
    for (const p of [
      {},
      { coworkerIds: ['other'] },
      { ...parent, parentId: 'root' },
      { ...parent, btwParentId: 'root' },
      { ...parent, child: {} },
    ]) {
      expect(selectSubagentDirectory({ p, c }, 'p')[0].canOpenConversation).toBe(false);
    }
    for (const mode of ['task']) {
      expect(
        selectSubagentDirectory({ p: parent, c: { ...c, child: { ...c.child, mode } } }, 'p')[0]
          .canOpenConversation
      ).toBe(false);
    }
    expect(selectSubagentDirectory({ p: parent, c: { ...c, parentId: 'q' } }, 'p')).toEqual([]);
  });

  it('缺省 mode 的旧在编协作者与顶部标签口径一致，可从目录恢复', () => {
    const c = { ...child(), child: { ...child().child, mode: undefined } };
    expect(
      selectSubagentDirectory({ p: { coworkerIds: ['c'], hiddenCoworkerIds: ['c'] }, c }, 'p')[0]
    ).toMatchObject({ mode: 'coworker', closed: false, canOpenConversation: true });
  });

  it('真实 ended/historyOnly 关闭实例并拒绝交互，实时 Run 不得复活历史', () => {
    const c = { ...child(), child: { ...child().child, mode: 'coworker' } };
    for (const lifecycle of [{ ended: true }, { historyOnly: true }]) {
      expect(
        selectSubagentDirectory({ p: { coworkerIds: ['c'] }, c: { ...c, ...lifecycle } }, 'p', [
          { agentId: 'agent', runId: 'late', status: 'running', elapsedMs: 1 },
        ])[0]
      ).toMatchObject({ closed: true, canOpenConversation: false, ended: true });
    }
  });

  it('来源、关闭和成员资格改变时更新缓存投影', () => {
    const c = { ...child(), child: { ...child().child, mode: 'coworker' } };
    const before = selectSubagentDirectory({ p: {}, c }, 'p');
    const member = selectSubagentDirectory({ p: { coworkerIds: ['c'] }, c }, 'p');
    expect(member).not.toBe(before);
    expect(member[0].canOpenConversation).toBe(true);
    const origin = selectSubagentDirectory(
      { p: { coworkerIds: ['c'] }, c: { ...c, child: { ...c.child, dispatchOrigin: 'manual' } } },
      'p'
    );
    expect(origin).not.toBe(member);
    expect(origin[0].origin).toBe('manual');
    expect(
      selectSubagentDirectory({ p: { coworkerIds: ['c'] }, c: { ...c, historyOnly: true } }, 'p')[0]
        .closed
    ).toBe(true);
  });

  it('current Main Run validation takes precedence over the previous successful run', () => {
    const c = {
      ...child(),
      status: 'idle',
      lastSubagentRun: { runId: 'old', status: 'succeeded', finishedAt: 1 },
    };
    const runs: AgentRunProgress[] = [
      { agentId: 'agent', runId: 'new', status: 'validating', elapsedMs: 2 },
    ];
    expect(selectSubagentDirectory({ p: {}, c }, 'p', runs)[0]).toMatchObject({
      status: 'validating',
      ended: false,
    });
    expect(selectSubagentDirectory({ p: {}, c: { ...c, ended: true } }, 'p', runs)[0].ended).toBe(
      true
    );
  });
  it('matches exact agent metadata under its parent, never names or constructed IDs', () => {
    const conversations = { p: {}, q: {}, arbitrary: child(), other: child('q') };
    expect(resolveSubagentTarget(conversations, 'p', 'agent')).toEqual({
      parentConversationId: 'p',
      childConversationId: 'arbitrary',
      title: 'Scout',
    });
    expect(resolveSubagentTarget(conversations, 'p', 'Same title')).toBeNull();
    expect(resolveSubagentTarget(conversations, 'q', 'agent')?.childConversationId).toBe('other');
  });

  it('rejects missing, mismatched, dirty metadata and missing parent', () => {
    for (const invalid of [
      { parentId: 'p', title: 'agent' },
      { ...child(), child: { ...child().child, parentId: 'q' } },
      { ...child(), child: { ...child().child, agentInstanceId: '' } },
      { ...child(), child: { ...child().child, dispatchOrigin: 'unknown' } },
      { ...child(), child: { ...child().child, dispatchOrigin: { toString: () => 'agent-tool' } } },
    ]) {
      expect(resolveSubagentTarget({ p: {}, invalid }, 'p', 'agent')).toBeNull();
    }
    expect(resolveSubagentTarget({ c: child() }, 'p', 'agent')).toBeNull();
  });

  it('returns null for ambiguous same-agent children rather than picking first', () => {
    expect(resolveSubagentTarget({ p: {}, a: child(), b: child() }, 'p', 'agent')).toBeNull();
  });

  it('one child shared by successive runs remains one target and one directory entry', () => {
    const c = { ...child(), runId: 'run-2', runs: ['run-1', 'run-2'] };
    expect(selectSubagentDirectory({ p: {}, c }, 'p')).toHaveLength(1);
    expect(resolveSubagentTarget({ p: {}, c }, 'p', 'run-1')).toBeNull();
    expect(resolveSubagentTarget({ p: {}, c }, 'p', 'agent')?.childConversationId).toBe('c');
  });

  it('projects reliable typed children and orders deterministically, ignoring cross-parent records', () => {
    const entries = selectSubagentDirectory(
      {
        p: {},
        q: {},
        z: child(),
        a: { ...child('p', 'second'), createdAt: 0 },
        foreign: child('q'),
        legacy: { parentId: 'p' },
        typed: {
          ...child('p', 'typed'),
          child: { ...child('p', 'typed').child, dispatchOrigin: 'typed-mention' },
        },
      },
      'p'
    );
    expect(entries.map((entry) => entry.childConversationId)).toEqual(['a', 'typed', 'z']);
    expect(entries[0]).toMatchObject({
      agentId: 'second',
      title: 'Scout',
      mode: 'task',
      status: 'running',
      createdAt: 0,
      ended: false,
    });
  });

  it('derives lifecycle status without calling idle a completed run', () => {
    const entries = selectSubagentDirectory(
      {
        p: {},
        a: { ...child('p', 'a'), status: 'idle' },
        b: { ...child('p', 'b'), spawning: true },
        c: { ...child('p', 'c'), ended: true },
        d: { ...child('p', 'd'), status: 'failed', error: 'failed', lastModelId: 'model' },
      },
      'p'
    );
    expect(entries.map((e) => [e.status, e.ended])).toEqual([
      ['waiting', false],
      ['starting', false],
      ['ended', true],
      ['failed', true],
    ]);
    expect(entries[3].modelId).toBe('model');
  });

  it('retains projection references through streaming-only changes, updates for visible metadata', () => {
    const before = selectSubagentDirectory({ p: {}, c: child() }, 'p');
    const after = selectSubagentDirectory({ p: {}, c: { ...child(), messages: ['stream'] } }, 'p');
    expect(after).toBe(before);
    expect(selectSubagentDirectory({ p: {}, c: { ...child(), status: 'idle' } }, 'p')).not.toBe(
      before
    );
  });

  it('uses authoritative latest-run outcomes only while idle; a new run overrides old failure', () => {
    const source = (status: string, extra = {}) => ({
      ...child(),
      status: 'idle',
      lastSubagentRun: { runId: 'run-1', status, finishedAt: 1, error: 'old error' },
      ...extra,
    });
    for (const status of ['succeeded', 'failed', 'cancelled', 'interrupted']) {
      const entry = selectSubagentDirectory({ p: {}, c: source(status) }, 'p')[0];
      expect(entry).toMatchObject({ status, ended: true });
    }
    expect(
      selectSubagentDirectory(
        { p: {}, c: source('failed', { status: 'running', error: 'old error' }) },
        'p'
      )[0]
    ).toMatchObject({ status: 'running', ended: false });
    expect(
      selectSubagentDirectory(
        { p: {}, c: source('failed', { spawning: true, error: 'old error' }) },
        'p'
      )[0]
    ).toMatchObject({ status: 'starting', ended: false });
  });
});
