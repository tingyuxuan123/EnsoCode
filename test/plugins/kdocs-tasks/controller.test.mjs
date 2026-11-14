import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createController } from '../../../examples/plugins/kdocs-tasks/lib/controller.mjs';

const ctx = (sessionId = 'session-1', projectRoot = '/test/erp') => ({
  sessionId,
  projectRoot,
  agent: null,
  signal: new AbortController().signal,
});
const row = () => ({
  id: 'ERP-1',
  description: '订单保存失败',
  owner: '谢',
  status: '待处理',
  notes: '人工备注',
  tests: '',
  row: 2,
});

async function fixture(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kdocs-controller-'));
  let current = row(),
    writes = 0;
  const config = {
    document_url: 'https://www.kdocs.cn/l/test',
    first_row: 2,
    last_row: 2,
    enable_writes: true,
  };
  const sheet = {
    tabId: null,
    async connect() {
      this.tabId = 'browser:test';
    },
    async readCell(address) {
      return address === 'A1' ? '编号' : '';
    },
    async readRow() {
      return { ...current };
    },
    async findRow(id) {
      if (id !== current.id) throw Error('not found');
      return { ...current };
    },
    async writeCell(address, before, after) {
      writes++;
      const field = { D: 'status', G: 'notes', H: 'tests' }[address[0]];
      if (!field) return;
      if (current[field] !== before) throw Error('conflict');
      current[field] = after;
    },
  };
  const enso = {
    dataDir,
    config: { get: async () => ({ ...config }) },
    browser: { invoke: async () => {} },
    ui: { view: { open: async () => {} } },
  };
  try {
    await run({
      dataDir,
      config,
      sheet,
      enso,
      get current() {
        return current;
      },
      get writes() {
        return writes;
      },
      controller: createController(enso, { sheetFactory: () => sheet }),
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}
async function ready(f) {
  await f.controller.call('connect', {}, ctx());
  await f.controller.call('calibrate', { address: 'A1', expected: '编号' }, ctx());
  await f.controller.call('test_write', { address: 'Z99' }, ctx());
  return f.controller.call('sync', { reset: true }, ctx());
}

test('未校准、未验证空白测试格、未启用写入都不能领取', async () =>
  fixture(async (f) => {
    await assert.rejects(f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx()));
    await ready(f);
    f.config.enable_writes = false;
    await assert.rejects(f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx()));
  }));

test('预览无远程副作用，确认后只执行一次，确认令牌不能重放', async () =>
  fixture(async (f) => {
    const scanned = await ready(f);
    assert.equal(scanned.tasks[0].claimable, true);
    const before = f.writes;
    const prepared = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    assert.equal(f.writes, before);
    assert.equal(prepared.preview.changes.length, 2);
    const result = await f.controller.call('confirm', { token: prepared.preview.token }, ctx());
    assert.equal(result.execution.phase, 'claimed');
    assert.equal(result.tasks.length, 0, '已领取条目不应还作为待办继续显示');
    assert.equal(f.current.status, '处理中');
    assert.ok(f.current.notes.startsWith('人工备注'));
    const written = f.writes;
    await assert.rejects(f.controller.call('confirm', { token: prepared.preview.token }, ctx()));
    assert.equal(f.writes, written);
  }));

test('预览后人工修改、会话变化、项目变化或模型子会话均不能执行确认', async () =>
  fixture(async (f) => {
    await ready(f);
    const prepared = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    await assert.rejects(
      f.controller.call('confirm', { token: prepared.preview.token }, ctx('session-2'))
    );
    await assert.rejects(
      f.controller.call('confirm', { token: prepared.preview.token }, ctx('session-1', '/other'))
    );
    await assert.rejects(
      f.controller.call(
        'confirm',
        { token: prepared.preview.token },
        { ...ctx(), agent: { kind: 'subagent' } }
      )
    );
    f.current.notes = '别人刚写了备注';
    const writes = f.writes;
    await assert.rejects(f.controller.call('confirm', { token: prepared.preview.token }, ctx()));
    assert.equal(f.current.status, '待处理');
    assert.equal(f.writes, writes);
  }));

test('确认之前持久化写入意图，中断后重新加载仍能核对，不能自动重放', async () =>
  fixture(async (f) => {
    await ready(f);
    const prepared = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    const real = f.sheet.writeCell;
    f.sheet.writeCell = async (...args) => {
      await real(...args);
      throw Error('network lost after commit');
    };
    const result = await f.controller.call('confirm', { token: prepared.preview.token }, ctx());
    assert.equal(result.execution.phase, 'unknown');
    const disk = JSON.parse(await readFile(join(f.dataDir, 'executions.json'), 'utf8'));
    assert.equal(Object.values(disk.sessions)[0].execution.phase, 'unknown');
    const second = createController(f.enso, { sheetFactory: () => f.sheet });
    await second.call('connect', {}, ctx());
    const writes = f.writes;
    const reconciled = await second.call('reconcile', {}, ctx());
    assert.equal(reconciled.execution.phase, 'partial');
    assert.equal(f.writes, writes);
    await assert.rejects(second.call('confirm', { token: prepared.preview.token }, ctx()));
  }));

test('同项目不同会话不重复接单，get_task不接受其他会话任意标识', async () =>
  fixture(async (f) => {
    await ready(f);
    const prepared = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    await f.controller.call('confirm', { token: prepared.preview.token }, ctx());
    await assert.rejects(f.controller.getTask(ctx('session-2')));
    await assert.rejects(f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx()));
    assert.equal((await f.controller.getTask(ctx())).task.id, 'ERP-1');
  }));

test('持久化坏配置不覆盖文件、令牌不进入存档或UI投影', async () =>
  fixture(async (f) => {
    await writeFile(join(f.dataDir, 'executions.json'), '{broken');
    await assert.rejects(f.controller.call('connect', {}, ctx()));
    assert.equal(await readFile(join(f.dataDir, 'executions.json'), 'utf8'), '{broken');
  }));

test('未配置文档也能打开助手查看准备提示，不触发网络', async () =>
  fixture(async (f) => {
    f.config.document_url = '';
    let opened = 0;
    f.enso.ui.view.open = async () => {
      opened++;
    };
    await f.controller.call('open_view', {}, ctx());
    assert.equal(opened, 1);
    assert.equal(f.sheet.tabId, null);
    const state = await f.controller.call('state', {}, ctx());
    assert.equal(state.configured, false);
    assert.equal(state.error, undefined, '首次未填链接是准备态，不是读取失败');
  }));

test('插入需求只返回文字，UI持有调用前草稿锁负责一次性插入', async () =>
  fixture(async (f) => {
    await ready(f);
    const prepared = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    await f.controller.call('confirm', { token: prepared.preview.token }, ctx());
    const result = await f.controller.call('insert_draft', {}, ctx());
    assert.match(result.text, /ERP-1/);
    assert.match(result.text, /get_task/);
  }));

test('同编号重新领取不继承旧报告，并保留上一轮交付记录', async () =>
  fixture(async (f) => {
    await ready(f);
    let preview = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    await f.controller.call('confirm', { token: preview.preview.token }, ctx());
    const input = {
      taskId: 'ERP-1',
      summary: '上一轮修复',
      cause: '字段校验',
      impact: '订单',
      reproduction: ['保存空订单'],
      environment: '本地',
      version: '未提交',
      prerequisites: '测试账号',
      steps: ['保存合法订单'],
      expected: '保存成功',
      actual: '未执行',
      regression: '未执行',
      unverified: '无环境',
      verification: 'not_tested',
      deployment: 'not_deployed',
      evidence: [],
    };
    await f.controller.call('save_report', { report: input }, ctx());
    preview = await f.controller.call('prepare_delivery', {}, ctx());
    const delivered = await f.controller.call('confirm', { token: preview.preview.token }, ctx());
    assert.equal(delivered.execution.phase, 'delivered');
    f.current.status = '待处理';
    await f.controller.call('sync', { reset: true }, ctx());
    preview = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    const claimed = await f.controller.call('confirm', { token: preview.preview.token }, ctx());
    assert.equal(claimed.execution.report, null);
    const disk = JSON.parse(await readFile(join(f.dataDir, 'executions.json'), 'utf8'));
    assert.equal(disk.sessions['session-1'].history[0].report.summary, '上一轮修复');
  }));

test('核对确认领取完全未应用后释放执行，但旧确认不能重放', async () =>
  fixture(async (f) => {
    await ready(f);
    const preview = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    f.sheet.writeCell = async () => {
      throw Error('before input');
    };
    const unknown = await f.controller.call('confirm', { token: preview.preview.token }, ctx());
    assert.equal(unknown.execution.phase, 'unknown');
    const reconciled = await f.controller.call('reconcile', {}, ctx());
    assert.equal(reconciled.execution.phase, 'cancelled');
    await assert.rejects(f.controller.call('confirm', { token: preview.preview.token }, ctx()));
    const next = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    assert.notEqual(next.preview.token, preview.preview.token);
  }));

test('重新连接会撤销旧预览和写校准，不能复用之前的确认令牌', async () =>
  fixture(async (f) => {
    await ready(f);
    const preview = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    const connected = await f.controller.call('connect', {}, ctx());
    assert.equal(connected.preview, null);
    assert.equal(connected.writeTested, false);
    await f.controller.call('calibrate', { address: 'A1', expected: '编号' }, ctx());
    await f.controller.call('test_write', { address: 'Z99' }, ctx());
    await assert.rejects(f.controller.call('confirm', { token: preview.preview.token }, ctx()));
  }));

test('只粘贴链接即可读取真实形状的表，不要求编号、测试列、校准或写开关', async () =>
  fixture(async (f) => {
    delete f.config.enable_writes;
    f.sheet.readTable = async () => ({
      sheet: '需求清单2026',
      text: `\t需求\t优先级\t状态\t负责人\t预计/天\t提出人\t备注\r\n\t${f.current.description}\t\t${f.current.status === '待处理' ? '' : f.current.status}\t谢\t\t\t${f.current.notes}`,
      range: { sheetId: '1', rowFrom: 0, rowTo: 200, colFrom: 0, colTo: 11 },
    });
    const state = await f.controller.call(
      'load',
      { url: 'https://www.kdocs.cn/l/test', owner: '谢' },
      ctx()
    );
    assert.equal(f.writes, 0);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].claimable, true);
    assert.equal(state.settings.owner, '谢');
    const saved = await f.controller.call('state', {}, ctx());
    assert.equal(saved.settings.url, 'https://www.kdocs.cn/l/test');
  }));

test('简易报告只需处理、测试与复测说明，不允许自动声称测试通过', async () =>
  fixture(async (f) => {
    await ready(f);
    const preview = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    await f.controller.call('confirm', { token: preview.preview.token }, ctx());
    const result = await f.controller.call(
      'save_simple_report',
      {
        summary: '修复图片地址',
        verification: 'not_tested',
        testing: '缺少环境，尚未测试',
        steps: '打开PWA\n查看图片',
      },
      ctx()
    );
    assert.equal(result.execution.report.verification, 'not_tested');
    assert.deepEqual(result.execution.report.steps, ['打开PWA', '查看图片']);
    assert.match(result.execution.report.text, /未测试/);
  }));

test('只有点击交给Agent才提交一次当前需求，重复点击不重复排队', async () =>
  fixture(async (f) => {
    let sent = 0;
    f.enso.session = {
      inject: async (input) => {
        sent++;
        assert.match(input.text, /get_task/);
        assert.equal(input.sessionId, undefined);
      },
    };
    await ready(f);
    const preview = await f.controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx());
    await f.controller.call('confirm', { token: preview.preview.token }, ctx());
    assert.equal(sent, 0);
    const state = await f.controller.call('send_task', {}, ctx());
    assert.equal(state.execution.dispatch, 'accepted');
    await assert.rejects(f.controller.call('send_task', {}, ctx()));
    assert.equal(sent, 1);
  }));
