import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReport,
  identifyTasks,
  parseConfig,
  planWrite,
} from '../../../examples/plugins/kdocs-tasks/lib/core.mjs';
import { detectTable, parseTsv } from '../../../examples/plugins/kdocs-tasks/lib/table.mjs';

const url = 'https://www.kdocs.cn/l/demo-requirements';
const range = { sheetId: '1', rowFrom: 0, rowTo: 200, colFrom: 0, colTo: 11 };
const header = '\t需求\t优先级\t状态\t负责人\t预计/天\t提出人\t备注';
const source = (body) => ({ text: `${header}\r\n${body}`, range, sheet: '需求清单2026' });
const report = () =>
  buildReport({
    taskId: 'placeholder',
    summary: '修复图片展示',
    cause: '图片地址',
    impact: 'PWA',
    reproduction: ['打开页面'],
    environment: '本地',
    version: '未提交',
    prerequisites: '测试账号',
    steps: ['打开PWA', '检查图片'],
    expected: '显示图片',
    actual: '未执行',
    regression: '未执行',
    unverified: '待测试',
    verification: 'not_tested',
    deployment: 'not_deployed',
    evidence: [],
  });

test('按真实表头识别需求/负责人/状态/备注，不要求编号和测试列', () => {
  const detected = detectTable(url, '谢', source('\t优化PWA图片\t高\t\t谢\t\t\t人工备注'));
  assert.deepEqual(detected.mapping, {
    id: null,
    description: 'B',
    owner: 'E',
    status: 'D',
    notes: 'H',
    tests: null,
  });
  assert.equal(detected.rows.length, 1);
  const config = parseConfig(detected.settings);
  assert.equal(identifyTasks(config, detected.rows)[0].claimable, true);
  assert.equal(config.sheetId, '1');
});

test('无编号时按需求内容与负责人生成稳定身份，排序不变，重复需求禁领', () => {
  const first = detectTable(url, '谢', source('\t甲需求\t\t\t谢\t\t\t\r\n\t乙需求\t\t\t谢\t\t\t'));
  const second = detectTable(url, '谢', source('\t乙需求\t\t\t谢\t\t\t\r\n\t甲需求\t\t\t谢\t\t\t'));
  assert.equal(first.rows[0].id, second.rows[1].id);
  const repeated = detectTable(
    url,
    '谢',
    source('\t甲需求\t\t\t谢\t\t\t\r\n\t甲需求\t\t\t谢\t\t\t')
  );
  assert.equal(
    identifyTasks(parseConfig(repeated.settings), repeated.rows).every((row) => !row.claimable),
    true
  );
});

test('没有测试列时只更新状态和备注，测试/复测说明一起追加，人工备注保留', () => {
  const detected = detectTable(url, '谢', source('\t优化PWA图片\t\t\t谢\t\t\t人工备注'));
  const config = parseConfig(detected.settings),
    row = { ...detected.rows[0], status: '处理中' };
  const candidate = { ...report(), taskId: row.id };
  const plan = planWrite(config, row, {
    kind: 'delivery',
    executionId: 'exec-test',
    time: 'now',
    report: candidate,
  });
  assert.deepEqual(
    plan.changes.map((c) => c.field),
    ['status', 'notes']
  );
  const note = plan.changes.find((c) => c.field === 'notes').after;
  assert.ok(note.startsWith('人工备注'));
  assert.match(note, /复测/);
  assert.match(note, /未测试/);
});

test('TSV保留引号、换行和空单元格，不把多行需求错分行', () => {
  assert.deepEqual(parseTsv('a\t"含\t制表符"\t"多行\n需求"\r\nx\t"他说""好"""\t'), [
    ['a', '含\t制表符', '多行\n需求'],
    ['x', '他说"好"', ''],
  ]);
  assert.throws(() => parseTsv('"未闭合'));
});

test('缺少必要字段、重复表头或复制范围不对应时明确停止', () => {
  assert.throws(() =>
    detectTable(url, '谢', { text: '需求\t负责人\r\n甲\t谢', range, sheet: '需求清单2026' })
  );
  assert.throws(() =>
    detectTable(url, '谢', { text: '需求\t需求\t负责人\t状态\t备注', range, sheet: '需求清单2026' })
  );
  assert.throws(() => detectTable(url, '谢', { ...source(''), range: { ...range, rowFrom: 1 } }));
});
