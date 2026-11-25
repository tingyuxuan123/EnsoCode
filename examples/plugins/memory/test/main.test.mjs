import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { activate } from '../main.mjs';

async function mount(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'memory-host-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const tools = new Map(),
    methods = new Map(),
    events = new Map(),
    commands = new Map();
  const calls = [],
    notices = [];
  const api = {
    dataDir,
    tools: { register: (name, fn) => tools.set(name, fn) },
    renderer: { handle: (name, fn) => methods.set(name, fn) },
    events: { on: (name, fn) => events.set(name, fn) },
    commands: { register: (name, fn) => commands.set(name, fn) },
    config: { get: async () => ({ model: 'session' }) },
    ui: {
      view: { emit: async () => {}, open: async () => {} },
      notify: async (...args) => notices.push(args),
      clipboard: { writeText: async (text) => calls.push({ copy: text }) },
    },
    agent: {
      run: async (input) => {
        calls.push(input);
        return {
          text: JSON.stringify({
            memories: [{ content: '单元测试已验证此约定', kind: 'lesson' }],
            summary: '本轮完成了测试与回归验证。',
          }),
        };
      },
    },
  };
  await activate(api);
  const ctx = {
    sessionId: 's1',
    projectRoot: '/project/a',
    agent: null,
    signal: new AbortController().signal,
  };
  return {
    api,
    tools,
    methods,
    events,
    calls,
    notices,
    ctx,
    tool: async (name, args = {}, context = ctx) =>
      JSON.parse((await tools.get(name)(args, context)).content),
    call: (name, args = {}, context = ctx) => methods.get(name)(args, context),
    fire: (name, data = {}, context = ctx) => events.get(name)(data, context),
  };
}

test('seven tools register, schema-safe defaults work, and reads stay bounded', async (t) => {
  const f = await mount(t);
  assert.equal(f.tools.size, 7);
  const saved = await f.tool('memory_write', { content: '使用 node --test', scope: 'project' });
  assert.equal(saved.ok, true);
  const read = await f.tool('memory_read', { id: saved.memory.id });
  assert.match(read.items[0].content, /node --test/);
  const foreign = await f.tool(
    'memory_forget',
    { ids: [saved.memory.id] },
    { ...f.ctx, projectRoot: '/project/b' }
  );
  assert.equal(foreign.removed, 0);
  await f.call('settings', { enabled: false });
  assert.equal((await f.tool('memory_write', { content: '被禁用时不得写入' })).ok, false);
  assert.equal((await f.tool('memory_status')).enabled, false);
  assert.ok((await f.tools.get('memory_status')({}, f.ctx)).content.length <= 4000);
});

test('stable snapshots invalidate on any mutation, compaction, day or session boundary', async (t) => {
  const f = await mount(t);
  await f.tool('memory_write', { content: '已记住偏好' });
  const first = await f.fire('before_agent_start', { kind: 'user', prompt: '问题一' });
  assert.match(first.append, /已记住偏好/);
  assert.equal(
    (await f.fire('before_agent_start', { kind: 'user', prompt: '问题二' })).append,
    first.append
  );
  await f.tool('scratchpad', { action: 'add', text: '快照也必须包含新待办' });
  assert.match(
    (await f.fire('before_agent_start', { kind: 'user', prompt: '问题三' })).append,
    /新待办/
  );
  assert.equal(
    await f.fire(
      'before_agent_start',
      { kind: 'user', prompt: 'child' },
      { ...f.ctx, agent: { kind: 'subagent' } }
    ),
    undefined
  );
  await f.fire('before_compact');
  const logs = await f.tool('memory_read', { target: 'daily' });
  assert.equal(logs.items.filter((item) => item.kind === 'handoff').length, 1);
  await f.fire('after_compact');
});

test('optional auto-learning and summaries use one bounded model call with redacted buffered turns', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true, summarizeOnEnd: true });
  await f.fire('before_agent_start', {
    kind: 'user',
    prompt: '密码：hunter2 请记住这不是可保存的数据',
  });
  await f.fire('agent_end', { text: '收到，不会记录。' });
  await f.fire('before_agent_start', { kind: 'user', prompt: '我们已经完成测试，请记录经验' });
  await f.fire('agent_end', { text: '已完成全部测试。' });
  assert.equal(f.calls.length, 2);
  assert.ok(!JSON.stringify(f.calls).includes('hunter2'));
  assert.equal(f.calls[0].context, 'none');
  assert.equal(f.calls[0].timeoutMs, 20000);
  assert.equal((await f.tool('memory_read')).count, 1);
  const logs = await f.tool('memory_read', { target: 'daily' });
  assert.equal(logs.items.filter((item) => item.kind === 'summary').length, 1);
  await f.fire('session_end');
  assert.equal(f.calls.length, 2, 'finalized checkpoint must not make another paid request');
});

test('AI failures, malformed output, stale results and settings changes never break the conversation or save secrets', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true, summarizeOnEnd: false });
  f.api.agent.run = async () => {
    throw new Error('provider unavailable');
  };
  await f.fire('before_agent_start', { kind: 'user', prompt: '保存可复用经验内容' });
  await f.fire('agent_end', { text: '结束' });
  assert.ok(f.notices.some((args) => args.join(' ').includes('provider unavailable')));
  let finish;
  f.api.agent.run = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await f.fire('before_agent_start', { kind: 'user', prompt: '保存另外一条经验' });
  const pending = f.fire('agent_end', { text: '完成' });
  // Wait for a deterministic model-start signal rather than a timer.
  while (!finish) await new Promise(setImmediate);
  await f.call('settings', { enabled: false });
  finish({ text: '{"memories":[{"content":"不能写入迟到结果"}],"summary":"ignored"}' });
  await pending;
  await f.call('settings', { enabled: true });
  assert.equal((await f.tool('memory_read')).count, 0);
});

test('overlapping short turns keep FIFO user/assistant pairing and summarize the newest completed turn', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true });
  let unblock, started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const prompts = [];
  f.api.agent.run = async (input) => {
    prompts.push(JSON.parse(input.prompt));
    if (prompts.length === 1) {
      started();
      await new Promise((resolve) => {
        unblock = resolve;
      });
    }
    return { text: '{"memories":[],"summary":"已记录连续对话"}' };
  };
  await f.fire('before_agent_start', { kind: 'user', prompt: '第一轮问题内容' });
  const one = f.fire('agent_end', { text: '第一轮回答' });
  await startedPromise;
  await f.fire('before_agent_start', { kind: 'user', prompt: '第二轮问题内容' });
  const two = f.fire('agent_end', { text: '第二轮回答' });
  await f.fire('before_agent_start', { kind: 'user', prompt: '第三轮问题内容' });
  const three = f.fire('agent_end', { text: '第三轮回答' });
  unblock();
  await Promise.all([one, two, three]);
  assert.equal(prompts.length, 3);
  assert.deepEqual(
    prompts[2].turns.map((row) => [row.user, row.assistant]),
    [
      ['第一轮问题内容', '第一轮回答'],
      ['第二轮问题内容', '第二轮回答'],
      ['第三轮问题内容', '第三轮回答'],
    ]
  );
});

test('parallel projects merge automatic results without invalidating one another', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true });
  const waiting = new Map();
  let started;
  const bothStarted = new Promise((resolve) => {
    started = resolve;
  });
  f.api.agent.run = (input) =>
    new Promise((resolve) => {
      const key = JSON.parse(input.prompt).turns[0].user.includes('项目A') ? 'A' : 'B';
      waiting.set(key, resolve);
      if (waiting.size === 2) started();
    });
  const b = { ...f.ctx, sessionId: 's2', projectRoot: '/project/b' };
  await f.fire('before_agent_start', { kind: 'user', prompt: '项目A长期约定内容' });
  await f.fire('before_agent_start', { kind: 'user', prompt: '项目B长期约定内容' }, b);
  const one = f.fire('agent_end', { text: '好的' });
  const two = f.fire('agent_end', { text: '好的' }, b);
  await bothStarted;
  waiting.get('A')({ text: '{"memories":[{"content":"项目A约定"}],"summary":""}' });
  await one;
  waiting.get('B')({ text: '{"memories":[{"content":"项目B约定"}],"summary":""}' });
  await two;
  assert.equal((await f.tool('memory_read')).count, 1);
  assert.equal((await f.tool('memory_read', {}, b)).count, 1);
});

test('AI prompt stays under the host limit with full memories and 12 buffered long turns', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true, summarizeOnEnd: false });
  for (let i = 0; i < 40; i++)
    await f.tool('memory_write', { content: `编号${i} ${'资料'.repeat(970)}` });
  f.api.agent.run = async (input) => {
    assert.ok(input.prompt.length <= 65536);
    return { text: '{"memories":[],"summary":""}' };
  };
  for (let i = 0; i < 13; i++) {
    await f.fire('before_agent_start', {
      kind: 'user',
      prompt: `第${i}轮 ${'<正文>'.repeat(300)}`,
    });
    await f.fire('agent_end', { text: '回答'.repeat(600) });
  }
  assert.equal(f.notices.length, 0);
});

test('shutdown preserves pending FIFO turns whose end event is still queued by the host', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true });
  let unblock, started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  let count = 0;
  f.api.agent.run = async () => {
    if (++count === 1) {
      started();
      await new Promise((resolve) => {
        unblock = resolve;
      });
    }
    return { text: '{"memories":[],"summary":"结束时保留最后一轮总结"}' };
  };
  await f.fire('before_agent_start', { kind: 'user', prompt: '第一轮问题内容' });
  const one = f.fire('agent_end', { text: '第一轮回答' });
  await start;
  await f.fire('before_agent_start', { kind: 'user', prompt: '第二轮问题内容' });
  const close = f.fire('session_end');
  unblock();
  await Promise.all([one, close]);
  await f.fire('agent_end', { text: '排队到关闭后的第二轮回答' });
  assert.equal(count, 2);
  assert.equal(
    (await f.tool('memory_read', { target: 'daily' })).items.filter((row) => row.kind === 'summary')
      .length,
    1
  );
});

test('real OpenAI full optional payloads validate and normalize without turning create into edit', async (t) => {
  const f = await mount(t);
  const actual = {
    content: 'OPENAI_PLACEHOLDER_REGRESSION',
    target: 'long_term',
    kind: 'fact',
    scope: 'project',
    pinned: false,
    id: '',
  };
  const saved = await f.tool('memory_write', actual);
  assert.equal(saved.ok, true);
  assert.equal(saved.action, 'created');
  const manifest = JSON.parse(
    await readFile(new URL('../enso-plugin.json', import.meta.url), 'utf8')
  );
  for (const tool of manifest.contributes.agentTools) {
    const args = Object.fromEntries(
      Object.keys(tool.parameters.properties)
        .filter((key) => !tool.parameters.required?.includes(key))
        .map((key) => [key, null])
    );
    if (tool.name === 'memory_write') args.content = 'NULL_OPTIONAL_REGRESSION';
    if (tool.name === 'memory_forget') args.ids = [saved.memory.id];
    if (tool.name === 'memory_restore') continue;
    const validated = validateToolArguments(tool, {
      type: 'toolCall',
      id: 'verify',
      name: tool.name,
      arguments: args,
    });
    const result = await f.tool(tool.name, validated);
    assert.notEqual(result.ok, false, JSON.stringify({ name: tool.name, result }));
  }
});

test('a late old-generation close cannot delete a restarted session with the same id', async (t) => {
  const f = await mount(t);
  await f.call('settings', { autoLearn: true });
  let unblock, started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  let count = 0;
  f.api.agent.run = async () => {
    if (++count === 1) {
      started();
      await new Promise((resolve) => {
        unblock = resolve;
      });
    }
    return { text: '{"memories":[],"summary":""}' };
  };
  await f.fire('before_agent_start', { kind: 'user', prompt: '旧代问题内容' });
  const old = f.fire('agent_end', { text: '旧代回答' });
  await start;
  const close = f.fire('session_end');
  await f.fire('session_start');
  await f.fire('before_agent_start', { kind: 'user', prompt: '恢复后的新代问题内容' });
  unblock();
  await Promise.all([old, close]);
  await f.fire('agent_end', { text: '新代回答' });
  assert.equal(count, 2);
});
