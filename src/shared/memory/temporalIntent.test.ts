import { describe, expect, it } from 'vitest';
import { computeTemporalBoost, detectTemporalIntent } from './temporalIntent';

describe('detectTemporalIntent（正则门）', () => {
  it('年份 / 季度 / 相对词 / 中文关键词命中，普通技术词不命中', () => {
    expect(detectTemporalIntent('what did we decide in 2020')).toEqual({
      type: 'year',
      value: '2020',
      confidence: 1,
    });
    expect(detectTemporalIntent('Q1 2024 roadmap')).toMatchObject({ type: 'year', value: '2024' });
    expect(detectTemporalIntent('Q1 plan')?.type).toBe('relative');
    expect(detectTemporalIntent('recent changes to auth')?.type).toBe('relative');
    expect(detectTemporalIntent('last year migration')?.type).toBe('relative');
    expect(detectTemporalIntent('去年数据库选型')?.type).toBe('relative');
    expect(detectTemporalIntent('OAuth2 React hooks database design')).toBeNull();
    // 端口号 / 版本号里的四位数不该被当年份：\b 保证 8080、v2024x 不命中
    expect(detectTemporalIntent('listen on 8080')).toBeNull();
  });

  it('日文单字「前」「後」不算时间意图：目前 / 前提 / 后续 / 前后 等技术表述不得命中', () => {
    for (const q of ['目前的部署流程', '前提条件', '后续优化', '前后端分离方案', '後方互換性']) {
      expect(detectTemporalIntent(q), q).toBeNull();
    }
    // 完整词仍命中
    expect(detectTemporalIntent('去年数据库选型')?.type).toBe('relative');
    expect(detectTemporalIntent('迁移之前的架构')?.type).toBe('relative');
    expect(detectTemporalIntent('来年の計画')?.type).toBe('relative');
  });
});

describe('computeTemporalBoost', () => {
  const now = new Date('2025-01-01T00:00:00Z');
  it('无 event_start 为 0', () => {
    expect(computeTemporalBoost(null, now, { type: 'year', value: '2020', confidence: 1 })).toBe(0);
  });
  it('年份匹配最多加 0.1，年代不匹配不加分', () => {
    expect(
      computeTemporalBoost('2020-01-01', now, { type: 'year', value: '2020', confidence: 1 })
    ).toBeCloseTo(0.1, 10);
    expect(
      computeTemporalBoost('2021-01-01', now, { type: 'year', value: '2020', confidence: 1 })
    ).toBe(0);
    for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, -1, 5]) {
      const boost = computeTemporalBoost('2020-01-01', now, {
        type: 'year',
        value: '2020',
        confidence,
      });
      expect(Number.isFinite(boost)).toBe(true);
      expect(boost).toBeGreaterThanOrEqual(0);
      expect(boost).toBeLessThanOrEqual(0.1);
    }
  });
  it('relative 意图不因事件远近加分', () => {
    const intent = { type: 'relative' as const, value: null, confidence: 0.5 };
    const near = computeTemporalBoost('2024-12-31', now, intent);
    const far = computeTemporalBoost('2015-01-01', now, intent);
    expect(near).toBe(0);
    expect(far).toBe(0);
  });
});
