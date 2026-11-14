import { describe, expect, it } from 'vitest';
import {
  isWpsDocumentUrl,
  pageWpsRangePrepareScript,
  pageWpsRangeRecheckScript,
  pageWpsRangeVerifyScript,
  pageWpsReadinessScript,
  pageWpsSheetScript,
  parseWpsRangeAddress,
  parseWpsRangePrepare,
  parseWpsRangeReady,
  parseWpsRangeRecheck,
  parseWpsRangeSheet,
  parseWpsRangeVerify,
  WPS_RANGE_MAX_CELLS,
} from './wpsRange';

describe('parseWpsRangeAddress', () => {
  it('接受 A1:L201 内的单格与矩形，并归一化成大写', () => {
    expect(parseWpsRangeAddress('A1:L201')).toEqual({
      address: 'A1:L201',
      rowFrom: 0,
      rowTo: 200,
      colFrom: 0,
      colTo: 11,
    });
    expect(parseWpsRangeAddress('b2:c3')).toEqual({
      address: 'B2:C3',
      rowFrom: 1,
      rowTo: 2,
      colFrom: 1,
      colTo: 2,
    });
    expect(parseWpsRangeAddress('  L201  ')).toEqual({
      address: 'L201',
      rowFrom: 200,
      rowTo: 200,
      colFrom: 11,
      colTo: 11,
    });
    expect(WPS_RANGE_MAX_CELLS).toBe(2412);
  });

  it('拒绝越界、倒序、多段、sheet 前缀与任意 JS/参数', () => {
    for (const value of [
      '',
      'A0',
      'A202',
      'M1',
      'A1:M1',
      'A1:L202',
      'L201:A1',
      'B2:A1',
      'A1:B2:C3',
      'Sheet1!A1',
      'A1:L201,',
      '$A$1',
      'AA1',
      'A1 L201',
      '一1',
      "A1';window.pwned=1;//",
      1,
      null,
      undefined,
      { address: 'A1' },
    ])
      expect(parseWpsRangeAddress(value)).toBeNull();
  });
});

describe('isWpsDocumentUrl', () => {
  it('只放行固定 HTTPS 站点上的分享文档路径', () => {
    for (const url of [
      'https://www.kdocs.cn/l/abc',
      'https://kdocs.cn/l/abc-1_2/',
      'https://ap.wps.com/l/test-document',
      'https://www.kdocs.cn/cms/docs/d/xyz/',
      'https://www.kdocs.cn/l/abc?from=share#grid',
    ])
      expect(isWpsDocumentUrl(url)).toBe(true);
  });

  it('拒绝 http、任意页面、相似域名、凭证与端口', () => {
    for (const url of [
      'http://www.kdocs.cn/l/abc',
      'https://www.kdocs.cn/',
      'https://www.kdocs.cn/folder/123',
      'https://www.kdocs.cn/l/abc/extra',
      'https://www.kdocs.cn/l/',
      'https://evil.kdocs.cn/l/abc',
      'https://kdocs.cn.evil.test/l/abc',
      'https://kdocs.ap.wps.com/l/abc',
      'https://user:pass@www.kdocs.cn/l/abc',
      'https://www.kdocs.cn:8443/l/abc',
      'file:///etc/passwd',
      'javascript:alert(1)',
      '',
      '   ',
      42,
      null,
    ])
      expect(isWpsDocumentUrl(url)).toBe(false);
  });
});

type FakeNode = Record<string, any>;

const createDom = (
  options: {
    boxes?: FakeNode[];
    editors?: FakeNode[];
    sheets?: FakeNode[];
    loading?: FakeNode[];
    overlays?: FakeNode[];
    editLayer?: FakeNode | null;
    hit?: FakeNode | null;
    readyState?: string;
  } = {}
) => {
  const doc: FakeNode = {
    activeElement: null,
    readyState: options.readyState ?? 'complete',
    querySelector: (selector: string) =>
      selector === '#editDivContainer' ? (options.editLayer ?? null) : null,
    querySelectorAll: (selector: string) => {
      if (selector.includes('edit-box')) return options.boxes ?? [];
      if (selector.includes('edit-proxy')) return options.editors ?? [];
      if (selector.includes('loading') || selector.includes('aria-busy'))
        return options.loading ?? [];
      if (
        selector.includes('dialog') ||
        selector.includes('login') ||
        selector.includes('cover') ||
        selector.includes('mask')
      )
        return options.overlays ?? [];
      return options.sheets ?? [];
    },
    elementFromPoint: () => options.hit ?? null,
  };
  const window = { getComputedStyle: (node: FakeNode) => node.__style ?? {} };
  return { doc, window };
};

const box = (patch: FakeNode = {}): FakeNode => {
  const node: FakeNode = {
    tagName: 'input',
    value: patch.value ?? 'A1',
    selectionStart: 0,
    selectionEnd: String(patch.value ?? 'A1').length,
    disabled: false,
    readOnly: false,
    __style: patch.__style ?? {},
    getBoundingClientRect: () => ({ x: 10, y: 10, width: 120, height: 24, ...patch.rect }),
    contains: () => false,
    focus: () => {},
    select: () => {},
    ...patch,
  };
  return node;
};

const run = (script: string, dom: { doc: FakeNode; window: FakeNode }): unknown =>
  new Function('document', 'window', `return ${script}`)(dom.doc, dom.window);

const prepare = (dom: { doc: FakeNode; window: FakeNode }) => run(pageWpsRangePrepareScript(), dom);

describe('WPS 固定 DOM 脚本', () => {
  it('在原生指针点击之后聚焦并全选 namebox', () => {
    const target = box({ value: 'A1' });
    const dom = createDom({ boxes: [target], hit: target });
    // Host 先发原生指针点击让 RenderWidget 拿到键盘焦点，再由 prepare 保证 DOM focus + 全选
    dom.doc.activeElement = target;
    target.select = () => {
      target.selectionStart = 0;
      target.selectionEnd = String(target.value).length;
    };
    expect(prepare(dom)).toEqual({ ok: true });
    expect(dom.doc.activeElement).toBe(target);

    const unfocused = box({ value: 'A1' });
    const second = createDom({ boxes: [unfocused], hit: unfocused });
    unfocused.focus = () => {
      second.doc.activeElement = unfocused;
    };
    unfocused.select = () => {
      unfocused.selectionEnd = String(unfocused.value).length;
    };
    expect(prepare(second)).toEqual({ ok: true });
  });

  it('拒绝已有编辑态与焦点编辑代理，但 opacity:0 的未聚焦代理不算编辑', () => {
    const editor = box({});
    const activeEdit = createDom({ boxes: [box()], editors: [editor] });
    activeEdit.doc.activeElement = editor;
    expect(prepare(activeEdit)).toEqual({ ok: false, reason: 'editing' });

    const visibleEditor = box({
      __style: { display: 'block', visibility: 'visible', opacity: '1' },
    });
    expect(prepare(createDom({ boxes: [box()], editors: [visibleEditor] }))).toEqual({
      ok: false,
      reason: 'editing',
    });

    const transparentEditor = box({
      __style: { display: 'block', visibility: 'visible', opacity: '0' },
    });
    const target = box({});
    const dom = createDom({ boxes: [target], editors: [transparentEditor], hit: target });
    target.focus = () => {
      dom.doc.activeElement = target;
    };
    target.select = () => {
      target.selectionEnd = String(target.value).length;
    };
    expect(prepare(dom)).toEqual({ ok: true });
  });

  it('拒绝缺失/不可见/被提示挡住/聚焦失败/选择失败的 namebox', () => {
    expect(prepare(createDom({ boxes: [] }))).toEqual({ ok: false, reason: 'missing' });
    expect(prepare(createDom({ boxes: [box(), box()] }))).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(prepare(createDom({ boxes: [box({ rect: { width: 0, height: 0 } })] }))).toEqual({
      ok: false,
      reason: 'hidden',
    });
    const hiddenStyle = box({ __style: { display: 'none' } });
    expect(prepare(createDom({ boxes: [hiddenStyle] }))).toEqual({
      ok: false,
      reason: 'hidden',
    });
    const target = box({});
    expect(prepare(createDom({ boxes: [target], hit: box({}) }))).toEqual({
      ok: false,
      reason: 'covered',
    });
    // 原生点击没有落到地址框（DOM focus 仍是别处）时拒绝
    expect(prepare(createDom({ boxes: [target], hit: target }))).toEqual({
      ok: false,
      reason: 'focus',
    });
    const dom = createDom({ boxes: [target], hit: target });
    target.focus = () => {
      dom.doc.activeElement = target;
    };
    target.select = () => {
      target.selectionStart = 0;
      target.selectionEnd = 0;
    };
    expect(prepare(dom)).toEqual({ ok: false, reason: 'selection' });
    expect(parseWpsRangePrepare({ ok: false, reason: 'covered' })).toMatchObject({
      ok: false,
      reason: 'covered',
      message: expect.stringMatching(/提示|挡住/),
    });
  });

  it('Enter 前复查焦点、value 与命中；地址只作为 JSON 字面量注入', () => {
    const target = box({ value: 'A1:L201' });
    const okDom = createDom({ boxes: [target], hit: target });
    okDom.doc.activeElement = target;
    expect(run(pageWpsRangeVerifyScript('A1:L201'), okDom)).toEqual({ ok: true });

    const blurred = createDom({ boxes: [target], hit: target });
    expect(run(pageWpsRangeVerifyScript('A1:L201'), blurred)).toEqual({
      ok: false,
      reason: 'blurred',
    });
    const wrongValue = createDom({ boxes: [box({ value: 'A1' })], hit: target });
    wrongValue.doc.activeElement = wrongValue.doc.querySelectorAll('input.edit-box')[0];
    expect(run(pageWpsRangeVerifyScript('A1:L201'), wrongValue)).toEqual({
      ok: false,
      reason: 'value',
    });
    const covered = createDom({ boxes: [target], hit: box({}) });
    covered.doc.activeElement = target;
    expect(run(pageWpsRangeVerifyScript('A1:L201'), covered)).toEqual({
      ok: false,
      reason: 'covered',
    });
    const script = pageWpsRangeVerifyScript("B2';window.pwned=1;//");
    expect(script).toContain(JSON.stringify("B2';window.pwned=1;//"));
    expect(script).not.toContain("const expected = B2';");
  });

  it('读取唯一高亮工作表，兼容 .sheet-active 与 .sheet-name', () => {
    const fixture = createDom({ sheets: [{ textContent: '需求清单2026' }] });
    expect(run(pageWpsSheetScript(), fixture)).toEqual({ ok: true, sheet: '需求清单2026' });
    const real = createDom({ sheets: [{ textContent: ' 需求表 ' }] });
    expect(run(pageWpsSheetScript(), real)).toEqual({ ok: true, sheet: '需求表' });
    expect(run(pageWpsSheetScript(), createDom({ sheets: [] }))).toEqual({
      ok: false,
      reason: 'sheet',
    });
    expect(
      run(pageWpsSheetScript(), createDom({ sheets: [{ textContent: 'A' }, { textContent: 'B' }] }))
    ).toEqual({ ok: false, reason: 'sheet' });
    expect(
      run(
        pageWpsSheetScript(),
        createDom({ sheets: [{ textContent: 'A' }, { textContent: ' A ' }] })
      )
    ).toEqual({ ok: true, sheet: 'A' });
    expect(parseWpsRangeSheet({ ok: true, sheet: '需求清单2026' })).toEqual({
      ok: true,
      sheet: '需求清单2026',
    });
    expect(parseWpsRangeSheet({ ok: false, reason: 'sheet' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/工作表/),
    });
  });

  it('非法脚本结果直接报错，拒绝原因走闭集', () => {
    for (const raw of [undefined, null, {}, { ok: 'yes' }]) {
      expect(() => parseWpsRangePrepare(raw)).toThrow(/unexpected/i);
      expect(() => parseWpsRangeVerify(raw)).toThrow(/unexpected/i);
      expect(() => parseWpsRangeSheet(raw)).toThrow(/unexpected/i);
    }
    expect(parseWpsRangePrepare({ ok: false, reason: 'window.pwned' })).toMatchObject({
      ok: false,
      reason: 'hidden',
    });
    expect(parseWpsRangeVerify({ ok: false, reason: '<script>' })).toMatchObject({
      ok: false,
      reason: 'blurred',
    });
  });
});

describe('WPS 只读 readiness 与输入前 recheck', () => {
  it('就绪：地址框唯一可见且命中；缺地址框只在加载时返回 loading', () => {
    const target = box({});
    const ready = createDom({ boxes: [target], hit: target });
    expect(run(pageWpsReadinessScript(), ready)).toEqual({ ok: true, x: 70, y: 22 });

    const loadingPage = createDom({ readyState: 'loading' });
    expect(run(pageWpsReadinessScript(), loadingPage)).toEqual({
      ok: false,
      reason: 'loading',
    });
    const interactive = createDom({ readyState: 'interactive', loading: [box({})] });
    expect(run(pageWpsReadinessScript(), interactive)).toEqual({
      ok: false,
      reason: 'loading',
    });
    const missing = createDom({});
    expect(run(pageWpsReadinessScript(), missing)).toEqual({
      ok: false,
      reason: 'missing',
    });
    const hiddenBox = createDom({ boxes: [box({ __style: { display: 'none' } })] });
    expect(run(pageWpsReadinessScript(), hiddenBox)).toEqual({
      ok: false,
      reason: 'hidden',
    });
    const hiddenWhileLoading = createDom({
      boxes: [box({ __style: { display: 'none' } })],
      readyState: 'loading',
    });
    expect(run(pageWpsReadinessScript(), hiddenWhileLoading)).toEqual({
      ok: false,
      reason: 'loading',
    });
  });

  it('编辑态、登录提示与遮挡在 readiness 明确失败，不进入等待', () => {
    const editor = box({});
    const editing = createDom({ boxes: [box()], editors: [editor] });
    editing.doc.activeElement = editor;
    expect(run(pageWpsReadinessScript(), editing)).toEqual({ ok: false, reason: 'editing' });

    const loginMissing = createDom({
      boxes: [],
      overlays: [{ ...box({}), tagName: 'DIV', textContent: '请完成登录后使用' }],
    });
    expect(run(pageWpsReadinessScript(), loginMissing)).toEqual({ ok: false, reason: 'login' });

    const targetBox = box({});
    const headerButton = createDom({
      boxes: [targetBox],
      hit: targetBox,
      overlays: [{ ...box({}), tagName: 'BUTTON', textContent: '登录' }],
    });
    expect(run(pageWpsReadinessScript(), headerButton)).toEqual({ ok: true, x: 70, y: 22 });

    const target = box({});
    const covered = createDom({ boxes: [target], hit: box({}) });
    expect(run(pageWpsReadinessScript(), covered)).toEqual({ ok: false, reason: 'covered' });
    expect(parseWpsRangeReady({ ok: false, reason: 'login' })).toMatchObject({
      ok: false,
      reason: 'login',
      message: expect.stringMatching(/登录/),
    });
  });

  it('可见登录 banner 不挡 namebox 时允许只读；真正遮挡或缺失才登录失败', () => {
    const target = box({ value: 'A1' });
    const banner = { ...box({}), tagName: 'DIV', textContent: '立即登录' };
    // 顶部/底部登录 banner 可见但不挡地址框：仍可只读
    const allowed = createDom({ boxes: [target], hit: target, overlays: [banner] });
    expect(run(pageWpsReadinessScript(), allowed)).toEqual({ ok: true, x: 70, y: 22 });

    // 登录遮罩真的盖住地址框：明确登录失败
    const mask = { ...box({}), tagName: 'DIV', textContent: '扫码登录' };
    const blocked = createDom({ boxes: [target], hit: mask, overlays: [mask] });
    expect(run(pageWpsReadinessScript(), blocked)).toEqual({ ok: false, reason: 'login' });

    // 地址框缺失且登录提示可见：明确登录失败
    const missing = createDom({ boxes: [], overlays: [banner] });
    expect(run(pageWpsReadinessScript(), missing)).toEqual({ ok: false, reason: 'login' });

    // 非登录遮罩盖住地址框：普通遮挡
    const ordinary = createDom({ boxes: [target], hit: box({}), overlays: [] });
    expect(run(pageWpsReadinessScript(), ordinary)).toEqual({ ok: false, reason: 'covered' });

    // 隐藏的登录层不算提示
    const hiddenLogin = createDom({
      boxes: [],
      overlays: [
        { tagName: 'DIV', textContent: '请登录', ...box({ __style: { display: 'none' } }) },
      ],
    });
    expect(run(pageWpsReadinessScript(), hiddenLogin)).toEqual({ ok: false, reason: 'missing' });
  });

  it('真实 normal-grid：#editDivContainer 与焦点代理均透明时仍可只读', () => {
    const target = box({ value: 'A1' });
    const proxy = box({
      tagName: 'input',
      type: 'text',
      rect: { width: 100, height: 30 },
      __style: { display: 'block', visibility: 'visible', opacity: '0' },
    });
    const mask = box({ tagName: 'DIV', __style: { opacity: '1' } });
    const layer = box({
      tagName: 'DIV',
      id: 'editDivContainer',
      className: 'edit-container not-show-border support-z-index',
      __style: { display: 'block', visibility: 'visible', opacity: '0' },
    });
    proxy.parentElement = mask;
    mask.parentElement = layer;
    const dom = createDom({ boxes: [target], hit: target, editors: [proxy], editLayer: layer });
    dom.doc.activeElement = proxy;
    target.focus = () => {
      dom.doc.activeElement = target;
    };
    expect(run(pageWpsReadinessScript(), dom)).toEqual({ ok: true, x: 70, y: 22 });
    expect(prepare(dom)).toEqual({ ok: true });
  });

  it('F2 编辑层按 effective opacity 判定；祖先透明不误判，状态不明保守拒绝', () => {
    const target = box({});
    const layer = box({
      tagName: 'DIV',
      id: 'editDivContainer',
      __style: { display: 'block', visibility: 'visible', opacity: '1' },
    });
    const visibleLayer = createDom({ boxes: [target], hit: target, editLayer: layer });
    expect(run(pageWpsReadinessScript(), visibleLayer)).toEqual({
      ok: false,
      reason: 'editing',
    });
    expect(prepare(visibleLayer)).toEqual({ ok: false, reason: 'editing' });

    const transparentParent = box({ tagName: 'DIV', __style: { opacity: '0' } });
    layer.parentElement = transparentParent;
    const hiddenLayer = createDom({ boxes: [target], hit: target, editLayer: layer });
    expect(run(pageWpsReadinessScript(), hiddenLayer)).toEqual({ ok: true, x: 70, y: 22 });

    const unreadable = box({
      tagName: 'DIV',
      id: 'editDivContainer',
      __style: { display: 'block', opacity: 'weird' },
    });
    const unknown = createDom({ boxes: [target], hit: target, editLayer: unreadable });
    expect(run(pageWpsReadinessScript(), unknown)).toEqual({ ok: false, reason: 'editing' });
  });

  it('常显公式栏 editor-container 不误判；缺编辑层时可见 input 仍拦截', () => {
    const target = box({});
    const formula = box({
      tagName: 'DIV',
      className: 'canvas-editor-container',
      __style: { opacity: '1' },
    });
    // 公式栏不在固定编辑层选择范围内，不影响只读
    expect(formula.__style.opacity).toBe('1');
    const plain = createDom({ boxes: [target], hit: target });
    expect(run(pageWpsReadinessScript(), plain)).toEqual({ ok: true, x: 70, y: 22 });

    const editingInput = box({
      tagName: 'input',
      type: 'text',
      __style: { display: 'block', opacity: '1' },
    });
    const fixtureEditing = createDom({ boxes: [target], hit: target, editors: [editingInput] });
    expect(run(pageWpsReadinessScript(), fixtureEditing)).toEqual({
      ok: false,
      reason: 'editing',
    });

    const readonly = box({
      tagName: 'input',
      type: 'text',
      readOnly: true,
      __style: { display: 'block', opacity: '1' },
    });
    const readonlyDom = createDom({ boxes: [target], hit: target, editors: [readonly] });
    expect(run(pageWpsReadinessScript(), readonlyDom)).toEqual({ ok: true, x: 70, y: 22 });
  });

  it('输入前 recheck 只读确认焦点、全选与命中', () => {
    const target = box({ value: 'A1' });
    const ok = createDom({ boxes: [target], hit: target });
    ok.doc.activeElement = target;
    expect(run(pageWpsRangeRecheckScript(), ok)).toEqual({ ok: true });

    const blurred = createDom({ boxes: [target], hit: target });
    expect(run(pageWpsRangeRecheckScript(), blurred)).toEqual({
      ok: false,
      reason: 'blurred',
    });
    const partial = createDom({ boxes: [target], hit: target });
    partial.doc.activeElement = target;
    target.selectionEnd = 1;
    expect(run(pageWpsRangeRecheckScript(), partial)).toEqual({
      ok: false,
      reason: 'selection',
    });
    const coveredTarget = box({ value: 'A1' });
    const covered = createDom({ boxes: [coveredTarget], hit: box({}) });
    covered.doc.activeElement = coveredTarget;
    expect(run(pageWpsRangeRecheckScript(), covered)).toEqual({
      ok: false,
      reason: 'covered',
    });
    expect(parseWpsRangeRecheck({ ok: false, reason: 'blurred' })).toMatchObject({
      ok: false,
      reason: 'blurred',
      message: expect.stringMatching(/焦点已变化/),
    });
    for (const raw of [undefined, {}, { ok: 'x' }, { ok: true }, { ok: true, x: -1, y: 2 }])
      expect(() => parseWpsRangeReady(raw)).toThrow(/unexpected/i);
    for (const raw of [undefined, {}, { ok: 'x' }])
      expect(() => parseWpsRangeRecheck(raw)).toThrow(/unexpected/i);
    expect(parseWpsRangeReady({ ok: true, x: 12, y: 34 })).toEqual({ ok: true, x: 12, y: 34 });
  });
});
