import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReport,
  identifyTasks,
  parseConfig,
  planWrite,
  reconcileWrite,
  snapshotHash,
  taskKey,
} from '../../../examples/plugins/kdocs-tasks/lib/core.mjs';

const settings = (extra = {}) => ({ document_url: 'https://www.kdocs.cn/l/test-sheet', ...extra });
const row = (extra = {}) => ({
  id: 'ERP-1',
  description: '保存订单失败',
  owner: '谢',
  status: '待处理',
  notes: '人工备注',
  tests: '',
  row: 2,
  ...extra,
});

test('配置只接受明确的金山HTTPS文档，不接受凭证、伪域名或任意站点', () => {
  for (const url of [
    'http://www.kdocs.cn/l/x',
    'https://kdocs.cn.evil.example/l/x',
    'https://u:p@www.kdocs.cn/l/x',
    'file:///tmp/a',
    'https://example.com/a',
  ]) {
    assert.throws(() => parseConfig(settings({ document_url: url })));
  }
  assert.equal(parseConfig(settings()).owner, '谢');
  assert.throws(() => parseConfig(settings({ first_row: 1, last_row: 99999 })));
});

test('状态和列映射不能把负责人或需求正文作为可写列，也不能回填最终验收', () => {
  assert.throws(() => parseConfig(settings({ writable_fields: 'status,owner' })));
  assert.throws(() =>
    parseConfig(
      settings({
        mapping_json: JSON.stringify({
          id: 'A',
          description: 'B',
          owner: 'E',
          status: 'E',
          notes: 'G',
          tests: 'H',
        }),
      })
    )
  );
  assert.throws(() => parseConfig(settings({ review_status: '已完成' })));
  assert.throws(() => parseConfig(settings({ active_status: '已上线' })));
});

test('任务身份不含行号和分享跟踪参数，排序插行后仍为同一需求', () => {
  const a = parseConfig(settings());
  const b = parseConfig(settings({ document_url: `${a.url}?refer=copylink` }));
  assert.equal(taskKey(a, row()), taskKey(b, row({ row: 27 })));
  assert.notEqual(taskKey(a, row()), taskKey(a, row({ id: 'ERP-2' })));
  assert.notEqual(
    taskKey(a, row()),
    taskKey(parseConfig(settings({ sheet_name: '另一个工作表' })), row())
  );
});

test('负责人精确匹配且重复、缺失编号可见但不可领取', () => {
  const tasks = identifyTasks(parseConfig(settings()), [
    row(),
    row({ row: 3 }),
    row({ id: '', row: 4 }),
    row({ id: 'ERP-2', owner: '谢某', row: 5 }),
  ]);
  assert.equal(tasks.length, 3);
  assert.equal(
    tasks.every((item) => item.claimable === false),
    true
  );
  assert.match(tasks[0].reason, /重复/);
  assert.match(tasks[2].reason, /编号/);
});

test('快照包含人工备注与需求版本，但不因排序变动失效', () => {
  assert.equal(snapshotHash(row()), snapshotHash(row({ row: 7 })));
  assert.notEqual(snapshotHash(row()), snapshotHash(row({ notes: '其他人刚写的备注' })));
  assert.notEqual(snapshotHash(row()), snapshotHash(row({ owner: '其他人' })));
});

test('领取只改允许字段、保留人工备注，且不把处理者当负责人', () => {
  const plan = planWrite(parseConfig(settings()), row(), {
    kind: 'claim',
    executionId: 'run-1',
    time: '2026-11-14T10:00:00Z',
  });
  assert.deepEqual(
    plan.changes.map((c) => c.field),
    ['status', 'notes']
  );
  assert.equal(plan.changes[0].after, '处理中');
  assert.ok(plan.changes[1].after.startsWith('人工备注'));
  assert.ok(plan.changes[1].after.includes('run-1'));
  assert.equal(plan.expectedHash, snapshotHash(row()));
});

test('待测试回填包含复测说明，不覆盖原测试记录，也不允许缺少执行标识', () => {
  const report = buildReport(reportInput());
  const plan = planWrite(
    parseConfig(settings()),
    row({ status: '处理中', tests: '历史测试记录' }),
    { kind: 'delivery', executionId: 'run-1', time: '2026-11-14', report }
  );
  assert.equal(plan.changes.find((c) => c.field === 'status').after, '待测试');
  const tests = plan.changes.find((c) => c.field === 'tests').after;
  assert.ok(tests.startsWith('历史测试记录'));
  assert.match(tests, /未验证/);
  assert.match(tests, /复测/);
  assert.throws(() => planWrite(parseConfig(settings()), row(), { kind: 'claim' }));
});

test('公式、制表符、超长内容不进入浏览器写入', () => {
  for (const value of ['=HYPERLINK("evil")', '+1', '-1', '@sum', '\t危险']) {
    assert.throws(() =>
      planWrite(parseConfig(settings()), row({ notes: value }), {
        kind: 'claim',
        executionId: 'run-1',
        time: 'now',
      })
    );
  }
  assert.throws(() =>
    planWrite(parseConfig(settings()), row({ notes: 'x'.repeat(9000) }), {
      kind: 'claim',
      executionId: 'run-1',
      time: 'now',
    })
  );
});

test('成功、未应用、部分成功及并发冲突严格区分，不盲目重放备注', () => {
  const before = row();
  const plan = planWrite(parseConfig(settings()), before, {
    kind: 'claim',
    executionId: 'run-1',
    time: 'now',
  });
  const done = { ...before, ...Object.fromEntries(plan.changes.map((c) => [c.field, c.after])) };
  assert.equal(reconcileWrite(plan, done).state, 'applied');
  assert.equal(reconcileWrite(plan, before).state, 'not_applied');
  assert.equal(reconcileWrite(plan, { ...before, status: '处理中' }).state, 'partial');
  assert.equal(reconcileWrite(plan, { ...done, description: '需求已变更' }).state, 'conflict');
});

function reportInput(extra = {}) {
  return {
    taskId: 'ERP-1',
    summary: '修复保存流程',
    cause: '字段校验',
    impact: '订单编辑',
    reproduction: ['进入订单', '保存空名称'],
    environment: '未提供测试环境',
    version: '本地工作区未提交',
    prerequisites: '测试账号',
    steps: ['输入合法名称后保存'],
    expected: '保存成功',
    actual: '未执行',
    regression: '未执行',
    unverified: '缺少测试账号',
    evidence: [],
    verification: 'not_tested',
    deployment: 'not_deployed',
    ...extra,
  };
}

test('报告明确未测试和未部署，不把模型声明提升为已核验事实', () => {
  const report = buildReport(reportInput());
  assert.match(report.text, /未测试/);
  assert.match(report.text, /未部署/);
  assert.match(report.text, /候选/);
  assert.throws(() => buildReport(reportInput({ verification: 'all_passed' })));
  assert.throws(() => buildReport(reportInput({ steps: [] })));
  assert.throws(() => buildReport(reportInput({ evidence: ['file:///etc/passwd'] })));
  assert.throws(() => buildReport(reportInput({ verification: 'not_tested', unverified: '' })));
});
