import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { onLoad } from '../../../examples/plugins/kdocs-tasks/ui.js';

const html = await readFile(
  new URL('../../../examples/plugins/kdocs-tasks/tasks.html', import.meta.url),
  'utf8'
);
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
const tick = () => new Promise((resolve) => setImmediate(resolve));
const initial = () => ({
  configured: true,
  connected: true,
  calibrated: true,
  writeTested: true,
  writingEnabled: true,
  settings: {
    url: 'https://www.kdocs.cn/l/test',
    sheet: '需求清单2026',
    owner: '谢',
    firstRow: 2,
    lastRow: 2,
  },
  tasks: [],
  sync: { cursor: 3, done: true, total: 1 },
  execution: null,
  preview: null,
});

async function mount(call, run) {
  const window = new Window();
  window.document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, '');
  window.enso = { call };
  try {
    window.eval(script);
    await tick();
    await run(window.document, window);
  } finally {
    window.happyDOM.cancelAsync();
    window.close();
  }
}

test('侧栏加载只读state，不连接、不扫描、不尝试登录或回写', async () => {
  const calls = [];
  await mount(
    async (method, args) => {
      calls.push([method, args]);
      return { configured: false, tasks: [] };
    },
    async (document) => {
      assert.deepEqual(
        calls.map(([method]) => method),
        ['state']
      );
      assert.equal(document.getElementById('btn-load').disabled, false);
      assert.equal(document.getElementById('f-url').type, 'text');
      assert.doesNotMatch(document.body.textContent, /JSON|校准|DOM选择器/);
    }
  );
});

test('更换来源后旧确认和发送也失效，不能只清空列表却保留旧操作', async () => {
  const state = initial(),
    calls = [];
  state.execution = { executionId: 'run', taskId: 'ERP-1', phase: 'claimed' };
  state.preview = {
    token: 'old',
    taskId: 'ERP-1',
    changes: [{ field: 'status', before: '', after: '处理中' }],
  };
  await mount(
    async (method) => {
      calls.push(method);
      return state;
    },
    async (document, window) => {
      const url = document.getElementById('f-url');
      url.value = 'https://www.kdocs.cn/l/another';
      url.dispatchEvent(new window.Event('input'));
      assert.equal(document.getElementById('preview-card').hidden, true);
      assert.equal(document.getElementById('btn-send').disabled, true);
      assert.equal(document.getElementById('btn-preview').disabled, true);
      document.getElementById('btn-confirm').click();
      await tick();
      assert.deepEqual(calls, ['state']);
    }
  );
});

test('需求与预览中的HTML保持字面量，不成为脚本或图片', async () => {
  const state = initial();
  state.tasks = [
    {
      id: 'ERP-1',
      description: '<img src=x onerror=alert(1)>',
      status: '待处理',
      row: 2,
      claimable: true,
    },
  ];
  state.preview = {
    token: 'once',
    taskId: 'ERP-1',
    changes: [{ field: 'notes', before: '<script>evil()</script>', after: '新备注' }],
  };
  await mount(
    async () => state,
    async (document) => {
      assert.equal(document.querySelectorAll('img,script').length, 0);
      assert.match(document.getElementById('tasks').textContent, /<img/);
      assert.match(document.getElementById('changes').textContent, /<script/);
    }
  );
});

test('确认只有明确点击才提交当前预览token，失败不自动重试', async () => {
  const state = initial(),
    calls = [];
  state.preview = {
    token: 'once',
    taskId: 'ERP-1',
    changes: [{ field: 'status', before: '待处理', after: '处理中' }],
  };
  await mount(
    async (method, args) => {
      calls.push([method, args]);
      if (method === 'confirm') throw Error('结果未知');
      return state;
    },
    async (document) => {
      assert.equal(calls.length, 1);
      document.getElementById('btn-confirm').click();
      await tick();
      await tick();
      const confirms = calls.filter(([method]) => method === 'confirm');
      assert.equal(confirms.length, 1);
      assert.equal(confirms[0][1].token, 'once');
      assert.match(document.getElementById('alert').textContent, /结果未知/);
    }
  );
});

test('不在输入框注册重复入口，只保留结果工具卡且清理幂等', () => {
  const slots = [],
    calls = [];
  let removed = 0;
  const cleanup = onLoad({
    React: { createElement() {} },
    slots: {
      register(entry) {
        slots.push(entry);
        return () => removed++;
      },
    },
    dispatch(...args) {
      calls.push(args);
    },
  });
  assert.deepEqual(
    slots.map((item) => item.slot),
    ['tool.card']
  );
  assert.equal(slots[0].toolName, 'build_report');
  assert.equal(calls.length, 0);
  cleanup();
  cleanup();
  assert.equal(removed, 1);
});

test('已回填的任务不再显示可用的发送或回填按钮', async () => {
  const state = initial();
  state.execution = {
    executionId: 'done',
    taskId: 'ERP-1',
    phase: 'delivered',
    description: '已处理需求',
  };
  await mount(
    async () => state,
    async (document) => {
      assert.equal(document.getElementById('btn-send').disabled, true);
      assert.equal(document.getElementById('btn-preview').disabled, true);
    }
  );
});

test('确认开始明确包含交给Agent，先领取成功再提交一次', async () => {
  const state = initial(),
    calls = [];
  state.preview = {
    kind: 'claim',
    token: 'start-once',
    taskId: 'ERP-1',
    changes: [{ field: 'status', before: '', after: '处理中' }],
  };
  await mount(
    async (method) => {
      calls.push(method);
      if (method === 'confirm')
        return {
          ...state,
          preview: null,
          execution: { executionId: 'run', taskId: 'ERP-1', phase: 'claimed' },
        };
      if (method === 'send_task')
        return {
          ...state,
          preview: null,
          execution: {
            executionId: 'run',
            taskId: 'ERP-1',
            phase: 'claimed',
            dispatch: 'accepted',
          },
        };
      return state;
    },
    async (document) => {
      assert.match(document.getElementById('btn-confirm').textContent, /交给/);
      document.getElementById('btn-confirm').click();
      await tick();
      await tick();
      assert.deepEqual(calls, ['state', 'confirm', 'send_task']);
    }
  );
});

const taskState = (extra = {}) => {
  const state = initial();
  state.tasks = [{ id: 'ERP-1', description: '需求A', status: '待处理', row: 2, claimable: true }];
  return { ...state, ...extra };
};
const page = (document) =>
  document.getElementById('tasks').textContent + document.getElementById('tasks-empty').textContent;

test('从未成功读取时不显示“暂时没有需求”', async () => {
  await mount(
    async () => ({
      configured: true,
      connected: false,
      settings: { url: 'https://www.kdocs.cn/l/test', owner: '谢' },
      tasks: [],
      sync: { cursor: 0, done: false },
      execution: null,
      preview: null,
    }),
    async (document) => {
      assert.doesNotMatch(page(document), /暂时没有/);
      assert.match(document.getElementById('tasks-empty').textContent, /还没读取/);
    }
  );
});

test('读取中清掉上一次的列表和领取按钮', async () => {
  let release = () => {};
  await mount(
    async (method) => {
      if (method === 'load') return new Promise((resolve) => (release = resolve));
      return taskState();
    },
    async (document) => {
      assert.match(document.getElementById('tasks').textContent, /需求A/);
      document.getElementById('btn-load').click();
      await tick();
      assert.match(document.getElementById('tasks-empty').textContent, /正在读取/);
      assert.equal(document.querySelectorAll('#tasks button').length, 0);
      release({ ...taskState(), tasks: [] });
      await tick();
      await tick();
    }
  );
});

test('读取被Plan拒绝时提示模式或会话未就绪，不保留旧列表也不假装成功', async () => {
  await mount(
    async (method) => {
      if (method === 'load') throw new Error('当前会话状态不允许插件修改文件或调用MCP');
      return taskState();
    },
    async (document) => {
      assert.match(document.getElementById('tasks').textContent, /需求A/);
      document.getElementById('btn-load').click();
      await tick();
      await tick();
      assert.doesNotMatch(page(document), /需求A/);
      assert.equal(document.querySelectorAll('#tasks button').length, 0);
      assert.match(document.getElementById('tasks-empty').textContent, /读取失败/);
      const alert = document.getElementById('alert').textContent;
      assert.match(alert, /计划模式或会话尚未就绪/);
      assert.match(alert, /读取待办不受影响/);
      assert.doesNotMatch(alert, /切到执行模式|不能操作表格/);
      assert.doesNotMatch(document.body.textContent, /发一句消息|MCP/);
    }
  );
});

test('主程序缺少新版读取能力时提示重启，不误报计划模式', async () => {
  await mount(
    async (method) => {
      if (method === 'load') throw new Error('unknown browser op: unsupported read_range');
      return taskState();
    },
    async (document) => {
      document.getElementById('btn-load').click();
      await tick();
      await tick();
      const alert = document.getElementById('alert').textContent;
      assert.match(alert, /尚未加载新版表格读取能力/);
      assert.match(alert, /重启开发版/);
      assert.doesNotMatch(alert, /计划模式/);
      assert.match(document.getElementById('tasks-empty').textContent, /读取失败/);
      assert.equal(document.querySelectorAll('#tasks button').length, 0);
    }
  );
});

test('读取失败不自动重试，也不自动往对话发消息', async () => {
  const calls = [];
  await mount(
    async (method) => {
      calls.push(method);
      if (method === 'load') throw new Error('当前会话状态不允许插件修改文件或调用MCP');
      return taskState();
    },
    async (document) => {
      document.getElementById('btn-load').click();
      await tick();
      await tick();
      await tick();
      assert.deepEqual(calls, ['state', 'load']);
      assert.match(document.getElementById('alert').textContent, /读取待办不受影响/);
    }
  );
});

test('持久缓存已断开时不显示真实零条', async () => {
  await mount(
    async () => ({
      ...initial(),
      connected: false,
      tasks: [],
      sync: { cursor: 3, done: true, total: 1 },
    }),
    async (document) => {
      assert.doesNotMatch(page(document), /暂时没有/);
      assert.match(document.getElementById('tasks-empty').textContent, /还没读取|重新读取/);
    }
  );
});

test('未读取时改链接也提示需要重新读取', async () => {
  await mount(
    async () => ({ ...initial(), connected: false, tasks: [], sync: { done: false } }),
    async (document, window) => {
      assert.match(document.getElementById('tasks-empty').textContent, /还没读取/);
      const owner = document.getElementById('f-owner');
      owner.value = '李';
      owner.dispatchEvent(new window.Event('input'));
      await tick();
      assert.match(document.getElementById('tasks-empty').textContent, /已更改/);
    }
  );
});

test('改链接后旧待办立刻失效并提示重新读取', async () => {
  await mount(
    async () => taskState(),
    async (document, window) => {
      assert.match(document.getElementById('tasks').textContent, /需求A/);
      assert.equal(document.querySelectorAll('#tasks button').length, 1);
      const url = document.getElementById('f-url');
      url.value = 'https://www.kdocs.cn/l/other';
      url.dispatchEvent(new window.Event('input'));
      await tick();
      assert.doesNotMatch(page(document), /需求A/);
      assert.equal(document.querySelectorAll('#tasks button').length, 0);
      assert.match(document.getElementById('tasks-empty').textContent, /重新读取/);
    }
  );
});

test('读取成功但没有需求时才显示“暂时没有”', async () => {
  await mount(
    async () => ({ ...initial(), tasks: [], sync: { cursor: 3, done: true, total: 1 } }),
    async (document) => {
      document.getElementById('btn-load').click();
      await tick();
      await tick();
      assert.match(document.getElementById('tasks-empty').textContent, /暂时没有/);
      assert.equal(document.getElementById('alert').hidden, true);
    }
  );
});

test('页面不提示“先发一句消息”，打开时也不自动发消息暖机', async () => {
  const calls = [];
  await mount(
    async (method) => {
      calls.push(method);
      return { configured: false, tasks: [] };
    },
    async () => {
      assert.doesNotMatch(html, /发一句消息/);
      assert.deepEqual(calls, ['state']);
    }
  );
});
