import { setTimeout as delay } from 'node:timers/promises';
import { FIELDS, parseConfig, safeCell } from './core.mjs';
import { columnIndex, parseTsv, tableRows } from './table.mjs';

const ADDRESS = /^[A-Z]{1,2}[1-9][0-9]{0,5}$/;
const SELECTORS = {
  name: 'input.edit-box',
  editor: 'input.edit-proxy-runs',
  sheet:
    '.et-status-sheet-item.selected .sheet-name, .sheet-active, [role="tab"][aria-selected="true"]',
};
const items = (value) => {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  throw new Error('浏览器 DOM 检查结果不兼容，请更新 Collabra');
};

export class BrowserSheet {
  constructor(invoke, config, selectors = {}) {
    this.invoke = invoke;
    this.config = config;
    this.selectors = { ...SELECTORS, ...selectors };
    this.tabId = null;
  }
  async call(op, args = {}) {
    return this.invoke(op, { ...args, ...(this.tabId ? { tabId: this.tabId } : {}) });
  }
  async connect() {
    const page = await this.invoke('navigate', { url: this.config.url, newTab: true });
    if (!page || typeof page.tabId !== 'string') throw new Error('宿主未返回浏览器标签标识');
    this.tabId = page.tabId;
    // 不重试导航，不刷新、不自动登录。用户可在该标签完成登录/选择工作表，再点击校准。
    return page;
  }
  async inspect(selector) {
    return items(await this.call('inspect', { selector }));
  }
  async readStable(op, args = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.call(op, args);
      } catch (error) {
        if (
          attempt >= 5 ||
          !/Page changed while reading|refresh browser_snapshot|快照.*过期/.test(
            error.message ?? ''
          )
        )
          throw error;
        await delay(150);
      }
    }
  }
  async assertSheet(discover = false) {
    if (!this.tabId) throw new Error('请先连接文档');
    const page = await this.readStable('read');
    let canonical;
    try {
      canonical = parseConfig({ document_url: page?.url }).canonical;
    } catch {}
    if (canonical !== this.config.canonical)
      throw new Error('浏览器已切换到另一份文档或预览页，旧授权失效，请重新连接');
    const selected = await this.inspect(this.selectors.sheet);
    const names = [
      ...new Set(selected.map((item) => String(item.text ?? '').trim()).filter(Boolean)),
    ];
    if (discover && names.length === 1) this.config.sheet = names[0];
    if (names.length !== 1 || names[0] !== this.config.sheet)
      throw new Error(
        `无法确认当前高亮工作表为“${this.config.sheet}”，请手动切换；结构变化时配置 DOM 选择器后重新校准`
      );
  }
  async ref(selector) {
    await this.readStable('snapshot');
    const found = await this.inspect(selector);
    if (found.length !== 1 || !found[0].ref)
      throw new Error('无法唯一定位可见的单元格地址框/编辑器，已停止');
    return found[0];
  }
  async select(address, rangeAllowed = false) {
    if (
      !(
        ADDRESS.test(address) ||
        (rangeAllowed && /^[A-Z]{1,2}[1-9][0-9]{0,5}:[A-Z]{1,2}[1-9][0-9]{0,5}$/.test(address))
      )
    )
      throw new Error('不是有效的表格地址');
    await this.call('press_key', { key: 'Escape' });
    await this.assertSheet();
    const name = await this.ref(this.selectors.name);
    await this.call('click', { ref: name.ref });
    await this.call('press_key', { key: 'Home' });
    await this.call('press_key', { key: 'Shift+End' });
    await this.call('press_key', { key: 'Backspace' });
    await this.call('insert_text', { text: address });
    const typed = await this.inspect(this.selectors.name);
    if (typed.length !== 1 || String(typed[0].value).toUpperCase() !== address)
      throw new Error('地址输入未生效，已停止');
    await this.call('press_key', { key: 'Enter' });
    const selected = await this.inspect(this.selectors.name);
    const allowedNames = rangeAllowed ? [address, address.split(':')[0]] : [address];
    if (selected.length !== 1 || !allowedNames.includes(String(selected[0].value).toUpperCase()))
      throw new Error('表格定位未成功，已停止，不会向未知位置输入');
    await this.assertSheet();
  }
  async readCell(address) {
    if (!ADDRESS.test(address)) throw new Error('单格读取不接受范围');
    await this.select(address);
    try {
      const copied = await this.call('copy_selection');
      this.assertRange(copied, address);
      const matrix = parseTsv(copied.text);
      if (matrix.length !== 1 || matrix[0].length !== 1 || matrix[0][0].length > 8000)
        throw new Error('无法确认完整单格内容，已停止');
      return matrix[0][0];
    } finally {
      await this.call('press_key', { key: 'Escape' });
    }
  }
  async writeCell(address, before, after) {
    safeCell(before);
    safeCell(after);
    if ((await this.readCell(address)) !== before) throw new Error('人工内容已变更，旧预览失效');
    await this.select(address);
    await this.call('press_key', { key: 'F2' });
    let committed = false;
    try {
      await this.call('press_key', { key: 'Home' });
      await this.call('press_key', { key: 'Shift+End' });
      await this.call('press_key', { key: 'Backspace' });
      await this.call('insert_text', { text: after });
      // 从此处起异常视为可能已提交；调用者必须读回核对，不能重放 Enter/备注。
      await this.call('press_key', { key: 'Enter' });
      committed = true;
    } finally {
      if (!committed) await this.call('press_key', { key: 'Escape' }).catch(() => {});
    }
    const actual = await this.readCell(address);
    if (actual !== after) throw new Error('写后读回不一致，结果待核对');
  }
  async readRow(row) {
    if (this.config.assistantAuto) {
      const table = await this.readTable();
      const result = tableRows(this.config, parseTsv(table.text)).find((item) => item.row === row);
      if (!result) throw new Error('需求行已被移动或清空，请刷新待办');
      return result;
    }
    const result = { row };
    for (const field of FIELDS)
      result[field] = await this.readCell(`${this.config.mapping[field]}${row}`);
    return result;
  }
  async findRow(taskId) {
    if (this.config.assistantAuto) {
      const table = await this.readTable();
      const found = tableRows(this.config, parseTsv(table.text)).filter((row) => row.id === taskId);
      if (found.length !== 1) throw new Error('需求已变更或有重复内容，请刷新后核对');
      return found[0];
    }
    const found = [];
    for (let row = this.config.firstRow; row <= this.config.lastRow; row++) {
      if ((await this.readCell(`${this.config.mapping.id}${row}`)).trim() === taskId)
        found.push(row);
    }
    if (found.length !== 1)
      throw new Error('扫描范围内编号缺失或重复，拒绝回写；请检查需求是否被移出范围');
    return this.readRow(found[0]);
  }
  assertRange(copied, address) {
    const match = /^([A-Z]{1,2})([1-9][0-9]*)(?::([A-Z]{1,2})([1-9][0-9]*))?$/.exec(address);
    const range = copied?.range;
    if (
      !match ||
      typeof copied?.text !== 'string' ||
      copied.truncated ||
      !range ||
      range.rowFrom !== Number(match[2]) - 1 ||
      range.rowTo !== Number(match[4] ?? match[2]) - 1 ||
      range.colFrom !== columnIndex(match[1]) ||
      range.colTo !== columnIndex(match[3] ?? match[1]) ||
      (this.config.sheetId && range.sheetId !== this.config.sheetId)
    )
      throw new Error('复制结果不是刚才选中的单元格/工作表，已停止，避免读错或写错');
  }
  async readTable({ discover = false } = {}) {
    const address = 'A1:L201';
    // 只读是宿主固定语义，不再借用通用键盘/导航写权限，也不自动唤醒模型。
    const copied = await this.call('read_range', { url: this.config.url, address });
    if (
      !copied ||
      typeof copied.tabId !== 'string' ||
      parseConfig({ document_url: copied.url }).canonical !== this.config.canonical
    )
      throw new Error('浏览器返回了另一份文档，已停止读取');
    if (
      typeof copied.sheet !== 'string' ||
      !copied.sheet.trim() ||
      (!discover && copied.sheet !== this.config.sheet)
    )
      throw new Error('无法确认当前工作表，已停止读取');
    this.assertRange(copied, address);
    if (discover) this.config.sheet = copied.sheet;
    this.tabId = copied.tabId;
    return copied;
  }
}
