import type { JsonSchema } from '@shared/capabilities/types';
import { describe, expect, it } from 'vitest';
import { matchesJsonSchema } from '../tooling/productCapabilityCoverage.fixture';
import { normalizeKimiCuArguments } from './mcpKimiCu';

const rect = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
  },
  required: ['x', 'y', 'width', 'height'],
};

/** 取自 KimiCU 0.6.8 tools/list（去掉 description） */
const getAppStateSchema = {
  type: 'object',
  properties: {
    rect,
    snapshot_id: { type: 'string' },
    ax_filter: { type: 'string' },
    app: { type: 'string' },
    mode: { type: 'string', enum: ['full', 'image', 'ax'] },
    offset: { type: 'integer', minimum: 0, maximum: 4000 },
    window_id: { type: 'integer' },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 120 },
    pid: { type: 'integer' },
    disable_diff: { type: 'boolean' },
    screenshot_detail: { type: 'string', enum: ['standard', 'high'] },
    additional_window_ids: { type: 'array', items: { type: 'integer' } },
  },
};

const getWindowStateSchema = {
  type: 'object',
  properties: {
    screenshot_detail: { type: 'string', enum: ['standard', 'high'] },
    app: { type: 'string' },
    rect,
    window_id: { type: 'integer' },
    include_screenshot: { type: 'boolean' },
    include_text: { type: 'boolean' },
    pid: { type: 'integer' },
  },
};

const typeTextSchema = {
  type: 'object',
  properties: {
    app: { type: 'string' },
    text: { type: 'string' },
    index: { type: 'integer' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
  required: ['text'],
};

/** 真机会话里 gpt-6.1-sol 填齐全部可选字段的 get_app_state 载荷 */
const filledFull = {
  rect: { x: 0, y: 0, width: 1500, height: 900 },
  snapshot_id: '',
  ax_filter: '',
  app: 'com.github.Electron',
  mode: 'full',
  offset: 0,
  window_id: 0,
  limit: 120,
  pid: 2907,
  disable_diff: true,
  screenshot_detail: 'standard',
  additional_window_ids: [],
};

const normalize = (tool: string, schema: object, args: unknown) => {
  const result = normalizeKimiCuArguments(tool, schema, args);
  expect(matchesJsonSchema(schema as JsonSchema, result), JSON.stringify(result)).toBe(true);
  expect(normalizeKimiCuArguments(tool, schema, result), '幂等').toEqual(result);
  return result;
};

describe('normalizeKimiCuArguments', () => {
  it('非 ax 模式丢弃分页参数，不再触发 “AX pagination requires mode=ax”', () => {
    expect(normalize('get_app_state', getAppStateSchema, filledFull)).toEqual({
      rect: { x: 0, y: 0, width: 1500, height: 900 },
      app: 'com.github.Electron',
      mode: 'full',
      pid: 2907,
      disable_diff: true,
      screenshot_detail: 'standard',
    });
  });

  it('省略 mode（默认 full）时同样丢弃分页参数', () => {
    expect(
      normalize('get_app_state', getAppStateSchema, { app: 'com.apple.finder', limit: 120 })
    ).toEqual({ app: 'com.apple.finder' });
  });

  it('ax 分页丢弃截图参数，不再触发 “does not accept screenshot arguments”', () => {
    expect(
      normalize('get_app_state', getAppStateSchema, {
        ...filledFull,
        mode: 'ax',
        rect: { x: 0, y: 0, width: 1800, height: 1250 },
        additional_window_ids: [42],
      })
    ).toEqual({
      app: 'com.github.Electron',
      mode: 'ax',
      offset: 0,
      limit: 120,
      pid: 2907,
      disable_diff: true,
    });
  });

  it('ax 分页的续页参数原样保留', () => {
    const page = { app: 'com.apple.finder', mode: 'ax', offset: 120, snapshot_id: 'snap-1' };
    expect(normalize('get_app_state', getAppStateSchema, page)).toEqual(page);
  });

  it('不分页时保留截图参数与额外窗口', () => {
    const args = {
      app: 'com.apple.finder',
      mode: 'full',
      screenshot_detail: 'high',
      rect: { x: 10, y: 20, width: 300, height: 200 },
      additional_window_ids: [7],
    };
    expect(normalize('get_app_state', getAppStateSchema, args)).toEqual(args);
  });

  it('丢弃空 app、0 号窗口和零尺寸 rect 占位，保留真实目标', () => {
    expect(
      normalize('get_window_state', getWindowStateSchema, {
        app: '',
        window_id: 0,
        pid: 84724,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        include_screenshot: true,
      })
    ).toEqual({ pid: 84724, include_screenshot: true });
    expect(
      normalize('get_window_state', getWindowStateSchema, {
        app: 'com.github.Electron',
        window_id: 10708,
      })
    ).toEqual({ app: 'com.github.Electron', window_id: 10708 });
  });

  it('必填字段即使为空也原样交给服务端，坐标 0 与 index 0 不当占位', () => {
    const args = { text: '', index: 0, x: 0, y: 0, app: '  ' };
    expect(normalize('type_text', typeTextSchema, args)).toEqual({
      text: '',
      index: 0,
      x: 0,
      y: 0,
    });
  });

  it('不改动传入对象，非对象参数原样返回', () => {
    const args = { ...filledFull };
    normalizeKimiCuArguments('get_app_state', getAppStateSchema, args);
    expect(args).toEqual(filledFull);
    expect(normalizeKimiCuArguments('get_app_state', getAppStateSchema, undefined)).toBe(undefined);
    expect(normalizeKimiCuArguments('get_app_state', getAppStateSchema, 'x')).toBe('x');
  });
});
