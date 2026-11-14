import { createHash } from 'node:crypto';

export const FIELDS = ['id', 'description', 'owner', 'status', 'notes', 'tests'];
const WRITABLE = ['status', 'notes', 'tests'];
const HOSTS = ['www.kdocs.cn', 'kdocs.cn', 'ap.wps.com'];
const FINAL = /完成|验收|上线|关闭|done|closed|accepted|deployed/i;
const DEFAULT_MAPPING = {
  id: 'A',
  description: 'B',
  status: 'D',
  owner: 'E',
  notes: 'G',
  tests: 'H',
};
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const text = (value, name, max = 2000) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    [...value].some((char) => char.codePointAt(0) < 32 && !'\t\n\r'.includes(char))
  )
    throw new Error(`${name} 缺失、过长或含控制字符`);
  return value.trim();
};
const list = (value) =>
  text(value, '列表', 500)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const positive = (value, fallback) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw new Error('行号无效');
  return n;
};

export function parseConfig(raw = {}) {
  let url;
  try {
    url = new URL(raw.document_url);
  } catch {
    throw new Error('请粘贴需求表链接');
  }
  const share = /^\/(?:l\/|cms\/docs\/d\/)([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !HOSTS.includes(url.hostname) ||
    !share
  )
    throw new Error('仅支持金山/WPS 的 HTTPS 分享文档，不接受账户凭证');
  const canonical = `https://${url.hostname === 'kdocs.cn' ? 'www.kdocs.cn' : url.hostname}/l/${share[1]}`;
  const sheet = text(raw.sheet_name ?? '需求清单2026', '工作表', 100);
  let mapping;
  try {
    mapping = raw.mapping_json ? JSON.parse(raw.mapping_json) : { ...DEFAULT_MAPPING };
  } catch {
    throw new Error('列映射必须为 JSON 对象');
  }
  if (
    !mapping ||
    Array.isArray(mapping) ||
    typeof mapping !== 'object' ||
    Object.keys(mapping).length !== FIELDS.length ||
    FIELDS.some(
      (field) =>
        !(
          /^[A-Z]{1,2}$/.test(mapping[field]) ||
          (['id', 'tests'].includes(field) && mapping[field] === null)
        )
    )
  )
    throw new Error('列映射必须完整包含 id/description/owner/status/notes/tests，列号使用 A-ZZ');
  const mapped = Object.values(mapping).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) throw new Error('不同字段不能映射到同一列');
  const writable = list(raw.writable_fields ?? 'status,notes,tests');
  if (
    writable.some((field) => !WRITABLE.includes(field)) ||
    !['status', 'notes', ...(mapping.tests ? ['tests'] : [])].every((field) =>
      writable.includes(field)
    )
  )
    throw new Error('首版仅允许并需要 status,notes,tests 三个写入字段，负责人和正文只读');
  const firstRow = positive(raw.first_row, 2);
  const lastRow = positive(raw.last_row, 20);
  if (lastRow < firstRow || lastRow - firstRow >= 200) throw new Error('一次最多读取200行');
  const active = text(raw.active_status ?? '处理中', '处理中状态', 40);
  const review = text(raw.review_status ?? '待测试', '待测试状态', 40);
  const blocked = text(raw.blocked_status ?? '受阻', '受阻状态', 40);
  const pending = list(raw.pending_statuses ?? '待处理');
  if (raw.accept_blank_status === true) pending.push('');
  if (
    [active, review, blocked, ...pending].some((status) => FINAL.test(status)) ||
    new Set([active, review, blocked, ...pending]).size !== 3 + pending.length
  )
    throw new Error('状态不能重复，也不能映射为最终完成、验收或上线');
  return {
    url: url.href,
    canonical,
    sheet,
    owner: text(raw.owner ?? '谢', '负责人', 80),
    mapping,
    writable,
    firstRow,
    lastRow,
    active,
    review,
    blocked,
    pending,
    ...(raw.sheet_id ? { sheetId: String(raw.sheet_id) } : {}),
    ...(raw.assistant_auto === true ? { assistantAuto: true } : {}),
  };
}

export function taskKey(config, row) {
  return hash([config.canonical, config.sheetId ?? config.sheet, String(row.id ?? '').trim()]);
}
export function snapshotHash(row) {
  return hash(FIELDS.map((field) => String(row[field] ?? '')));
}
export function identifyTasks(config, rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return rows
    .filter((row) => String(row.owner ?? '').trim() === config.owner)
    .map((row) => {
      const id = String(row.id ?? '').trim();
      const reason = !id
        ? '缺少唯一需求编号'
        : counts.get(id) !== 1
          ? config.mapping.id
            ? '编号重复'
            : '需求内容重复，暂时无法确定要处理哪条'
          : !config.pending.includes(row.status)
            ? '当前不是可领取状态'
            : !row.description.trim()
              ? '缺少需求正文'
              : '';
      return { ...row, key: taskKey(config, row), claimable: !reason, reason };
    });
}

export function safeCell(value) {
  if (
    typeof value !== 'string' ||
    value.length > 8000 ||
    [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127) ||
    /^[\s]*[=+\-@]/.test(value)
  )
    throw new Error(
      '为防止公式和范围注入，首版只回写不含换行、制表符及公式前缀的短纯文本；请先人工处理原内容'
    );
  return value;
}
const compact = (value) => value.replace(/[\r\n\t]+/g, ' ｜ ');

export function planWrite(config, row, action) {
  const executionId = text(action.executionId, '执行标识', 100);
  const time = text(action.time, '时间', 80);
  if (!row.id || row.owner.trim() !== config.owner || !row.description)
    throw new Error('编号、负责人或需求无效');
  let nextStatus, note, tests;
  const stamp = `[需求助手 ${executionId.slice(0, 12)} ${time.includes('T') ? time.slice(5, 16).replace('T', ' ') : time}]`;
  if (action.kind === 'claim') {
    if (!config.pending.includes(row.status)) throw new Error('需求已不在待处理状态');
    nextStatus = config.active;
    note = `${stamp} 开始处理`;
  } else if (action.kind === 'delivery') {
    if (row.status !== config.active || !action.report || action.report.taskId !== row.id)
      throw new Error('只能回填当前执行中的同一需求');
    nextStatus = action.blocked ? config.blocked : config.review;
    note = `${stamp} ${compact(action.report.summary)}`;
    tests = `${stamp} ${compact(action.report.text)}`;
    if (!config.mapping.tests) {
      const result =
        {
          not_tested: '未测试',
          cannot_reproduce: '无法复现',
          local_passed: '本地通过',
          test_env_passed: '测试环境通过',
        }[action.report.verification] ?? '待核对';
      note = `${stamp} 处理：${compact(action.report.summary)} ｜ 测试：${result}；${compact(action.report.actual)} ｜ 复测：${action.report.steps.map((step, index) => `${index + 1}. ${compact(step)}`).join('；')}${action.report.unverified ? ` ｜ 未验证：${compact(action.report.unverified)}` : ''}`;
      tests = null;
    }
  } else throw new Error('不支持的写入动作');
  const changes = [
    { field: 'status', before: row.status, after: nextStatus },
    { field: 'notes', before: row.notes, after: row.notes ? `${row.notes} ｜ ${note}` : note },
  ];
  if (tests)
    changes.push({
      field: 'tests',
      before: row.tests,
      after: row.tests ? `${row.tests} ｜ ${tests}` : tests,
    });
  for (const change of changes) {
    if (!config.writable.includes(change.field)) throw new Error('目标字段未被授权');
    safeCell(change.before);
    safeCell(change.after);
  }
  return {
    kind: action.kind,
    executionId,
    taskId: row.id,
    taskKey: taskKey(config, row),
    expectedHash: snapshotHash(row),
    original: { ...row },
    changes,
  };
}

export function reconcileWrite(plan, current) {
  if (
    FIELDS.filter((field) => !plan.changes.some((change) => change.field === field)).some(
      (field) => current[field] !== plan.original[field]
    )
  )
    return { state: 'conflict' };
  const matched = plan.changes.filter((change) => current[change.field] === change.after).length;
  if (matched === plan.changes.length) return { state: 'applied' };
  if (plan.changes.every((change) => current[change.field] === change.before))
    return { state: 'not_applied' };
  if (plan.changes.every((change) => [change.before, change.after].includes(current[change.field])))
    return { state: 'partial' };
  return { state: 'conflict' };
}

const REPORT_FIELDS = [
  'taskId',
  'summary',
  'cause',
  'impact',
  'environment',
  'version',
  'prerequisites',
  'expected',
  'actual',
  'regression',
  'unverified',
  'verification',
  'deployment',
];
export function buildReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('报告必须为对象');
  const report = {};
  for (const field of REPORT_FIELDS) {
    if (field === 'unverified' && input[field] === '') report[field] = '';
    else report[field] = text(input[field], field, field === 'summary' ? 500 : 1000);
  }
  for (const field of ['reproduction', 'steps', 'evidence']) {
    const items = input[field];
    if (!Array.isArray(items) || items.length > 12 || (field !== 'evidence' && !items.length))
      throw new Error(`${field} 必须为有效列表`);
    report[field] = items.map((item) => text(item, field, 500));
  }
  for (const link of report.evidence) {
    let url;
    try {
      url = new URL(link);
    } catch {
      throw new Error('证据链接必须是HTTPS地址');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('证据链接必须是HTTPS地址');
  }
  const verified = {
    not_tested: '未测试',
    cannot_reproduce: '无法复现',
    local_passed: '本地通过（Agent声明）',
    test_env_passed: '测试环境通过（Agent声明）',
  };
  const deployed = { not_deployed: '未部署', test_only: '仅测试环境（Agent声明）' };
  if (!verified[report.verification] || !deployed[report.deployment])
    throw new Error('测试或部署状态无效，不能声明生产上线/最终验收');
  if (['not_tested', 'cannot_reproduce'].includes(report.verification) && !report.unverified)
    throw new Error('必须说明未验证原因');
  const lines = [
    '【交付候选，非独立核验/最终验收】',
    `需求：${report.taskId}`,
    `处理：${report.summary}`,
    `原因：${report.cause}`,
    `影响：${report.impact}`,
    `原问题复现：${report.reproduction.map((step, index) => `${index + 1}. ${step}`).join('；')}`,
    `环境：${report.environment}；版本：${report.version}；前置条件：${report.prerequisites}`,
    `复测：${report.steps.map((step, index) => `${index + 1}. ${step}`).join('；')}`,
    `预期：${report.expected}；实际：${report.actual}`,
    `测试：${verified[report.verification]}；回归：${report.regression}`,
    `未验证：${report.unverified || '无（Agent声明，待人工核对）'}`,
    `部署：${deployed[report.deployment]}`,
    `证据：${report.evidence.join('；') || '未提供'}`,
  ];
  report.text = lines.join('\n');
  if (report.text.length > 6000) throw new Error('报告过长，请缩减后回填，详细记录另附链接');
  return report;
}
