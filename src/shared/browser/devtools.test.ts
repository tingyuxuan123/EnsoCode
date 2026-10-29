import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  assertDevtoolsIdle,
  DEVTOOLS_BUSY_ERROR,
  DEVTOOLS_DOCK_BRIDGE_SCRIPT,
  devtoolsGuestBounds,
  parseDevtoolsDockMessage,
  resetUndockedDevtoolsPreference,
} from './devtools';

describe('resetUndockedDevtoolsPreference', () => {
  const prefs = (dock: string) =>
    JSON.stringify({
      electron: { devtools: { preferences: { currentDockState: dock, other: '1' } } },
      keep: { x: 1 },
    });
  it('只把 undocked 改回 bottom，其余偏好原样保留', () => {
    const next = resetUndockedDevtoolsPreference(prefs('"undocked"'));
    expect(next).not.toBeNull();
    expect(JSON.parse(next as string)).toEqual({
      electron: { devtools: { preferences: { currentDockState: '"bottom"', other: '1' } } },
      keep: { x: 1 },
    });
  });
  it('已停靠、缺字段或坏 JSON 时不改写', () => {
    for (const raw of [
      prefs('"right"'),
      prefs('"bottom"'),
      '{}',
      '{"electron":{"devtools":{}}}',
      '{"electron":{"devtools":{"preferences":[]}}}',
      'not json',
      '[]',
    ])
      expect(resetUndockedDevtoolsPreference(raw), raw).toBeNull();
  });
});

describe('assertDevtoolsIdle', () => {
  it('关着 DevTools 时不抛', () => {
    expect(() => assertDevtoolsIdle(false)).not.toThrow();
  });

  it('开着时抛固定错误，agent 能读懂该关控制台', () => {
    expect(() => assertDevtoolsIdle(true)).toThrow(DEVTOOLS_BUSY_ERROR);
  });
});

const tag = '__enso_devtools_dock__';

describe('parseDevtoolsDockMessage', () => {
  it('只接受严格的关闭通知', () => {
    expect(parseDevtoolsDockMessage(`${tag}{"closed":true}`)).toEqual({ closed: true });
    for (const raw of ['{"closed":false}', '{"closed":"true"}', '{"closed":true,"extra":1}'])
      expect(parseDevtoolsDockMessage(`${tag}${raw}`)).toBeNull();
  });
  it('解析停靠方向与网页区域', () => {
    expect(parseDevtoolsDockMessage(`${tag}{"side":"right"}`)).toEqual({ side: 'right' });
    expect(parseDevtoolsDockMessage(`${tag}{"side":"undocked"}`)).toEqual({ side: 'undocked' });
    expect(
      parseDevtoolsDockMessage(`${tag}{"bounds":{"x":0,"y":0,"width":242.6,"height":336}}`)
    ).toEqual({ bounds: { x: 0, y: 0, width: 243, height: 336 } });
  });

  it('忽略普通日志与任何脏输入', () => {
    for (const raw of [
      'hello',
      `${tag}`,
      `${tag}not json`,
      `${tag}{"side":"top"}`,
      `${tag}{"side":1}`,
      `${tag}{"bounds":{"x":-1,"y":0,"width":1,"height":1}}`,
      `${tag}{"bounds":{"x":0,"y":0,"width":Infinity,"height":1}}`,
      `${tag}{"bounds":{"x":0,"y":0,"width":20000,"height":1}}`,
      `${tag}{"bounds":{"x":0,"y":0,"width":1}}`,
      `${tag}{"side":"right","extra":true}`,
      `${tag}[]`,
      `${tag}null`,
    ])
      expect(parseDevtoolsDockMessage(raw), raw).toBeNull();
  });
});

describe('DevTools embedder bridge', () => {
  it('自带关闭按钮交给宿主清理，不让 Electron 单独销毁前端而遗留布局', () => {
    const original = vi.fn();
    const debug = vi.fn();
    const api = { sendMessageToEmbedder: original };
    runInNewContext(DEVTOOLS_DOCK_BRIDGE_SCRIPT, {
      DevToolsAPI: api,
      console: { debug },
    });

    api.sendMessageToEmbedder('closeWindow', []);

    expect(debug.mock.calls.map(([message]) => parseDevtoolsDockMessage(message))).toContainEqual({
      closed: true,
    });
    expect(original).not.toHaveBeenCalled();
    api.sendMessageToEmbedder('unhandledMethod', ['keep']);
    expect(original).toHaveBeenCalledWith('unhandledMethod', ['keep'], undefined);
  });
});

describe('devtoolsGuestBounds', () => {
  const stage = { x: 100, y: 50, width: 800, height: 600 };
  it('把 DevTools 内的网页区域平移到屏幕坐标', () => {
    expect(devtoolsGuestBounds(stage, { x: 0, y: 0, width: 500, height: 600 })).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 600,
    });
    expect(devtoolsGuestBounds(stage, { x: 300, y: 0, width: 500, height: 600 })).toEqual({
      x: 400,
      y: 50,
      width: 500,
      height: 600,
    });
  });
  it('裁到舞台以内，空区域返回 null', () => {
    expect(devtoolsGuestBounds(stage, { x: 600, y: 0, width: 500, height: 900 })).toEqual({
      x: 700,
      y: 50,
      width: 200,
      height: 600,
    });
    expect(devtoolsGuestBounds(stage, { x: 0, y: 0, width: 0, height: 600 })).toBeNull();
    expect(devtoolsGuestBounds(stage, { x: 900, y: 0, width: 10, height: 10 })).toBeNull();
  });
});
