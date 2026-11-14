import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSheet } from '../../../examples/plugins/kdocs-tasks/lib/browser-sheet.mjs';
import { parseConfig } from '../../../examples/plugins/kdocs-tasks/lib/core.mjs';

function fixture(collapseRange = false) {
  let address = 'A1',
    editing = false,
    pending = '',
    focused = '',
    selected = false;
  const values = { A1: '编号', A2: 'ERP-1', G2: '人工备注' };
  const calls = [];
  const invoke = async (op, args) => {
    calls.push([op, args]);
    if (op === 'read_range') {
      address = args.address;
      const copied = await invoke('copy_selection', {});
      return { ...copied, url: args.url, tabId: 'tab', sheet: '需求清单2026' };
    }
    if (op === 'navigate') return { tabId: 'tab', url: args.url };
    if (op === 'snapshot')
      return '- textbox "" [ref=name] [kind=fill]\n- option "需求清单2026" [ref=sheet] [kind=click]';
    if (op === 'copy_selection') {
      const match = /^([A-Z])([0-9]+)(?::([A-Z])([0-9]+))?$/.exec(address);
      const rowFrom = Number(match[2]) - 1,
        rowTo = Number(match[4] ?? match[2]) - 1,
        colFrom = match[1].charCodeAt(0) - 65,
        colTo = (match[3] ?? match[1]).charCodeAt(0) - 65;
      const rows = [];
      for (let row = rowFrom; row <= rowTo; row++) {
        const cells = [];
        for (let col = colFrom; col <= colTo; col++)
          cells.push(values[String.fromCharCode(65 + col) + (row + 1)] ?? '');
        rows.push(cells.join('\t'));
      }
      return { text: rows.join('\r\n'), range: { sheetId: '1', rowFrom, rowTo, colFrom, colTo } };
    }
    if (op === 'inspect') {
      if (args.selector === 'input.edit-box')
        return [
          {
            tag: 'INPUT',
            value: collapseRange && selected ? address.split(':')[0] : address,
            ref: 'name',
          },
        ];
      if (args.selector === 'input.edit-proxy-runs')
        return editing ? [{ tag: 'INPUT', value: '', ref: 'editor' }] : [];
      return [{ tag: 'DIV', text: '需求清单2026' }];
    }
    if (op === 'click') {
      focused = args.ref;
      if (focused === 'name') selected = false;
    }
    if (op === 'insert_text') {
      if (focused === 'name') address += args.text;
      else pending += args.text;
    }
    if (op === 'fill') {
      if (args.ref === 'name') address = args.value;
      else pending = args.value;
    }
    if (op === 'press_key') {
      if (args.key === 'F2') {
        editing = true;
        pending = values[address] ?? '';
        focused = 'editor';
      }
      if (args.key === 'Escape') editing = false;
      if (args.key === 'Backspace') {
        if (editing) pending = '';
        else if (focused === 'name') address = '';
      }
      if (args.key === 'Enter' && editing) {
        values[address] = pending;
        editing = false;
      }
      if (args.key === 'Enter') selected = true;
    }
    return { url: 'https://www.kdocs.cn/l/test', tabId: 'tab' };
  };
  return {
    invoke,
    values,
    calls,
    get focused() {
      return focused;
    },
  };
}

test('读格只定位并取消编辑，不提交任何单元格修改', async () => {
  const fake = fixture();
  const sheet = new BrowserSheet(
    fake.invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  assert.equal(await sheet.readCell('A2'), 'ERP-1');
  assert.equal(fake.values.A2, 'ERP-1');
  assert.equal(fake.calls.filter(([op, args]) => op === 'fill' && args.ref === 'editor').length, 0);
  assert.equal(
    fake.calls.some(([op, args]) => op === 'press_key' && args.key === 'F2'),
    false
  );
  assert.equal(fake.calls.at(-1)[1].key, 'Escape');
});

test('单格写入重新核对旧值，人工已变更就拒绝、不填编辑器', async () => {
  const fake = fixture();
  const sheet = new BrowserSheet(
    fake.invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  await assert.rejects(sheet.writeCell('G2', '过期备注', '新的备注'));
  assert.equal(fake.values.G2, '人工备注');
  await sheet.writeCell('G2', '人工备注', '人工备注 ｜ 领取记录');
  assert.equal(fake.values.G2, '人工备注 ｜ 领取记录');
});

test('不能定位当前工作表或编辑器时安全失败，不假装读到空值', async () => {
  const fake = fixture();
  const invoke = async (op, args) =>
    op === 'inspect' && args.selector !== 'input.edit-box' ? [] : fake.invoke(op, args);
  const sheet = new BrowserSheet(
    invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  await assert.rejects(sheet.readCell('A2'));
});

test('禁止范围地址、公式与多行粘贴，避免跨格或公式注入', async () => {
  const fake = fixture();
  const sheet = new BrowserSheet(
    fake.invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  await assert.rejects(sheet.readCell('A1:B2'));
  await assert.rejects(sheet.writeCell('G2', '人工备注', '=1+1'));
  await assert.rejects(sheet.writeCell('G2', '人工备注', '一\t二'));
  assert.equal(fake.values.G2, '人工备注');
});

test('宿主显式标记内容被截断时拒绝把前缀当成完整备注', async () => {
  const fake = fixture();
  const invoke = async (op, args) =>
    op === 'copy_selection' ? { text: '被截断的原文', truncated: true } : fake.invoke(op, args);
  const sheet = new BrowserSheet(
    invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  await assert.rejects(sheet.readCell('G2'));
});

test('同域另一份文档即使表名相同也拒绝读取和写入', async () => {
  const fake = fixture();
  const invoke = async (op, args) =>
    op === 'read' ? { url: 'https://www.kdocs.cn/l/other-document' } : fake.invoke(op, args);
  const sheet = new BrowserSheet(
    invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  await assert.rejects(sheet.readCell('A2'));
  await assert.rejects(sheet.writeCell('G2', '人工备注', '不应写入'));
  assert.equal(fake.values.G2, '人工备注');
});

test('页面初次加载的只读快照竞争会短暂等待，不要求用户反复点按钮', async () => {
  const fake = fixture();
  let reads = 0;
  const invoke = async (op, args) => {
    if (op === 'read' && reads++ === 0)
      throw new Error('Page changed while reading; refresh browser_snapshot or browser_read.');
    return fake.invoke(op, args);
  };
  const sheet = new BrowserSheet(
    invoke,
    parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
  );
  await sheet.connect();
  assert.equal(await sheet.readCell('A2'), 'ERP-1');
});

test('金山选中大范围后只显示起始格，仍用复制元数据确认完整选区', async () => {
  const fake = fixture(true),
    sheet = new BrowserSheet(
      fake.invoke,
      parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
    );
  await sheet.connect();
  const result = await sheet.readTable();
  assert.equal(result.range.rowTo, 200);
  assert.equal(result.range.colTo, 11);
});

test('透明编辑代理不依赖可见ref或value，使用原生文字输入后读回', async () => {
  const fake = fixture(),
    sheet = new BrowserSheet(
      fake.invoke,
      parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
    );
  await sheet.connect();
  await sheet.writeCell('G2', '人工备注', '人工备注 ｜ 测试');
  assert.equal(fake.values.G2, '人工备注 ｜ 测试');
  assert.ok(
    fake.calls.some(([op, args]) => op === 'insert_text' && args.text === '人工备注 ｜ 测试')
  );
  assert.equal(
    fake.calls.some(([op, args]) => op === 'click' && args.ref === 'editor'),
    false
  );
});

test('新对话读取整表只调用受限read_range，不借通用写动作选区或要求先连接', async () => {
  const fake = fixture(),
    sheet = new BrowserSheet(
      fake.invoke,
      parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
    );
  const table = await sheet.readTable({ discover: true });
  assert.equal(table.sheet, '需求清单2026');
  assert.equal(sheet.tabId, 'tab');
  assert.equal(
    fake.calls.some(([op]) =>
      ['navigate', 'click', 'fill', 'press_key', 'insert_text'].includes(op)
    ),
    false
  );
  assert.equal(fake.calls.filter(([op]) => op === 'read_range').length, 1);
});

test('受限读取返回别的文档、工作表或选区都拒绝，不回退成通用写路径', async () => {
  for (const change of [
    { url: 'https://www.kdocs.cn/l/other' },
    { sheet: '别的表' },
    { range: { sheetId: '1', rowFrom: 0, rowTo: 0, colFrom: 0, colTo: 0 } },
  ]) {
    const calls = [];
    const sheet = new BrowserSheet(
      async (op) => {
        calls.push(op);
        return {
          tabId: 'tab',
          url: 'https://www.kdocs.cn/l/test',
          sheet: '需求清单2026',
          text: '',
          range: { sheetId: '1', rowFrom: 0, rowTo: 200, colFrom: 0, colTo: 11 },
          ...change,
        };
      },
      parseConfig({ document_url: 'https://www.kdocs.cn/l/test' })
    );
    await assert.rejects(sheet.readTable());
    assert.deepEqual(calls, ['read_range']);
  }
});
