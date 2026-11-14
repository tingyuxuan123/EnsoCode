import { FIELDS, hash, parseConfig } from './core.mjs';

export function parseTsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 65536)
    throw new Error('表格内容过大，请缩小选区');
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === '\t') {
      row.push(field);
      field = '';
      closed = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else {
      if (closed) throw new Error('复制内容格式不完整，请重新读取');
      field += char;
    }
  }
  if (quoted) throw new Error('复制内容引号未闭合');
  if (field || row.length || !rows.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
export function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export function columnIndex(name) {
  return [...name].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}
export function tableRows(config, matrix, rowOffset = 0, colOffset = 0) {
  const result = [];
  for (let index = 0; index < matrix.length; index++) {
    const rowNumber = index + rowOffset + 1;
    if (rowNumber < config.firstRow || rowNumber > config.lastRow) continue;
    const row = { row: rowNumber };
    for (const field of FIELDS)
      row[field] = config.mapping[field]
        ? String(matrix[index][columnIndex(config.mapping[field]) - colOffset] ?? '')
        : '';
    if (!row.description.trim()) continue;
    if (!config.mapping.id)
      row.id = `需求-${hash([row.description.trim(), row.owner.trim()]).slice(0, 12)}`;
    result.push(row);
  }
  return result;
}
const ALIASES = {
  id: ['编号', '需求编号', 'ID'],
  description: ['需求', '需求描述', '问题描述', '需求内容'],
  owner: ['负责人', '责任人'],
  status: ['状态', '处理状态'],
  notes: ['备注', '处理备注'],
  tests: ['测试情况', '测试记录'],
};
export function detectTable(url, owner, source) {
  if (source.range?.rowFrom !== 0 || source.range.colFrom !== 0 || !source.range.sheetId)
    throw new Error('无法确认表格选区，请重新读取');
  const matrix = parseTsv(source.text);
  if (
    matrix.length > source.range.rowTo + 1 ||
    matrix.some((row) => row.length > source.range.colTo + 1)
  )
    throw new Error('复制范围与内容不匹配');
  let mapping,
    header = -1;
  for (let index = 0; index < Math.min(matrix.length, 5); index++) {
    const candidate = {};
    let ambiguous = false;
    for (const [field, names] of Object.entries(ALIASES)) {
      const positions = matrix[index].flatMap((cell, col) =>
        names.includes(cell.trim()) ? [col] : []
      );
      if (positions.length > 1) ambiguous = true;
      candidate[field] = positions.length === 1 ? columnName(positions[0]) : null;
    }
    if (['description', 'owner', 'status', 'notes'].every((field) => candidate[field])) {
      if (ambiguous) throw new Error('表头有重名字段，无法安全判断回填位置');
      if (mapping) throw new Error('发现多个需求表头，请先选择正确工作表');
      mapping = candidate;
      header = index;
    }
  }
  if (!mapping) throw new Error('这张表需要“需求、负责人、状态、备注”四个表头；读取不会自动增加列');
  const settings = {
    document_url: url,
    owner,
    sheet_name: source.sheet,
    sheet_id: String(source.range.sheetId),
    mapping_json: JSON.stringify(mapping),
    first_row: header + 2,
    last_row: Math.min(source.range.rowTo + 1, 201),
    pending_statuses: '待处理,待办,未开始,未开发',
    accept_blank_status: true,
    assistant_auto: true,
  };
  const config = parseConfig(settings);
  return { mapping, settings, rows: tableRows(config, matrix), headerRow: header + 1 };
}
