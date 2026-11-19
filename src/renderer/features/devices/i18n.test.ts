import { getTranslation, zhTranslations } from '@shared/i18n';
import { describe, expect, it } from 'vitest';
import { DEVICES_KEYS, DEVICES_PROPER_NOUN_KEYS, devicesI18nKeys } from './i18n';

describe('devices pane i18n keys', () => {
  it('每个 key 都是英文原文，没有命名空间前缀', () => {
    for (const key of devicesI18nKeys) {
      expect(key, 'empty key').not.toBe('');
      expect(key, `namespaced key: ${key}`).not.toMatch(/^devices:/);
      expect(key, `Chinese text in a key: ${key}`).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('key 不重复', () => {
    expect(devicesI18nKeys.length).toBe(new Set(devicesI18nKeys).size);
  });

  it('中文表覆盖全部 key；除产品名外都不是原文回退', () => {
    for (const key of devicesI18nKeys) {
      expect(zhTranslations[key], `missing translation: ${key}`).toBeTypeOf('string');
      if (DEVICES_PROPER_NOUN_KEYS.includes(key)) continue;
      expect(getTranslation('zh', key), `untranslated: ${key}`).not.toBe(key);
    }
  });

  it('英文原样返回 key，插值占位符原样保留', () => {
    expect(getTranslation('en', 'Screen of {{name}}')).toBe('Screen of {{name}}');
    expect(getTranslation('zh', 'Screen of {{name}}')).toBe('{{name}} 的屏幕');
  });

  /**
   * 设备行整行都是「选中就启动」的按钮，行内那枚徽标只是状态。
   * 状态与动作同词时，用户会把「关机」当成动作去点，点是点了，行按钮回车后反而把设备启动。
   */
  it('行的关机状态不与关机动作同词', () => {
    expect(DEVICES_KEYS.rowShutdown).not.toBe(DEVICES_KEYS.shutDown);
    expect(getTranslation('zh', DEVICES_KEYS.rowShutdown)).not.toBe(
      getTranslation('zh', DEVICES_KEYS.shutDown)
    );
  });
});
