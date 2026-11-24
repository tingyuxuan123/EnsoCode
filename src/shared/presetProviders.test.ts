import { describe, expect, it } from 'vitest';
import {
  isValidPresetPort,
  PRESET_PROVIDERS,
  presetPortOf,
  presetProviderById,
  withPresetPort,
} from './presetProviders';

const MAGPIE_BASE = 'http://127.0.0.1:3425/v1';

describe('PRESET_PROVIDERS', () => {
  it('每条预设的定义都自洽：id 唯一、地址可解析、内置密钥非空', () => {
    const ids = new Set<string>();
    for (const preset of PRESET_PROVIDERS) {
      expect(preset.id).toBeTruthy();
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      // 地址要能被 URL 解析，否则卡片与端口弹窗拿不到 hostname
      expect(() => new URL(preset.baseUrl)).not.toThrow();
      // 本机代理类服务靠内置密钥免填；空值会让启用校验当成缺 key
      expect(preset.defaultApiKey.trim().length).toBeGreaterThan(0);
      expect(preset.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('Magpie 指向本机 3425 的 OpenAI 兼容入口', () => {
    const magpie = presetProviderById('magpie');
    expect(magpie?.baseUrl).toBe(MAGPIE_BASE);
    expect(magpie?.api).toBe('openai-completions');
    expect(magpie?.defaultApiKey).toBe('magpie');
    expect(magpie?.portEditable).toBe(true);
  });

  it('未知 id 返回 undefined，不抛异常', () => {
    expect(presetProviderById('nope')).toBeUndefined();
    expect(presetProviderById('')).toBeUndefined();
  });
});

describe('presetPortOf', () => {
  it('取出显式声明的端口', () => {
    expect(presetPortOf(MAGPIE_BASE)).toBe('3425');
  });

  it('未声明端口或地址非法时返回空串，由调用方当「没有端口」处理', () => {
    expect(presetPortOf('http://127.0.0.1/v1')).toBe('');
    expect(presetPortOf('')).toBe('');
    expect(presetPortOf('not a url')).toBe('');
    expect(presetPortOf('ftp://127.0.0.1:3425/v1')).toBe('');
  });
});

describe('isValidPresetPort', () => {
  it('接受 1–65535 的整数', () => {
    expect(isValidPresetPort('1')).toBe(true);
    expect(isValidPresetPort('3425')).toBe(true);
    expect(isValidPresetPort('65535')).toBe(true);
  });

  it('拒绝越界、零、负数、小数与非数字', () => {
    expect(isValidPresetPort('0')).toBe(false);
    expect(isValidPresetPort('65536')).toBe(false);
    expect(isValidPresetPort('-1')).toBe(false);
    expect(isValidPresetPort('3425.5')).toBe(false);
    expect(isValidPresetPort('abc')).toBe(false);
    expect(isValidPresetPort('')).toBe(false);
    // 前后空白不是数字，避免「 3425」被静默接受
    expect(isValidPresetPort(' 3425')).toBe(false);
  });
});

describe('withPresetPort', () => {
  it('换端口时保留主机与路径', () => {
    expect(withPresetPort(MAGPIE_BASE, '3426')).toBe('http://127.0.0.1:3426/v1');
  });

  it('原地址没有端口时补上端口', () => {
    expect(withPresetPort('http://127.0.0.1/v1', '3426')).toBe('http://127.0.0.1:3426/v1');
  });

  it('端口非法一律返回 null，不产出半个地址', () => {
    for (const port of ['0', '65536', 'abc', '', '-1', '3425.5']) {
      expect(withPresetPort(MAGPIE_BASE, port)).toBeNull();
    }
  });

  it('地址非法返回 null', () => {
    expect(withPresetPort('not a url', '3425')).toBeNull();
    expect(withPresetPort('', '3425')).toBeNull();
  });

  it('http 默认端口 80 被 URL 规范化掉，仍是等价地址而不是错误', () => {
    expect(withPresetPort(MAGPIE_BASE, '80')).toBe('http://127.0.0.1/v1');
  });

  it('不修改入参，且结果可再次被 URL 解析', () => {
    const base = MAGPIE_BASE;
    const next = withPresetPort(base, '4000');
    expect(base).toBe(MAGPIE_BASE);
    expect(next).not.toBeNull();
    expect(() => new URL(next as string)).not.toThrow();
  });
});
