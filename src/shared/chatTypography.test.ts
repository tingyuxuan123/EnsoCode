import { describe, expect, it } from 'vitest';
import {
  CHAT_TYPOGRAPHY_DEFAULTS,
  CHAT_TYPOGRAPHY_PARTS,
  chatTypographyVariables,
  normalizeChatTypography,
  parseChatTypography,
} from './chatTypography';

describe('聊天排版偏好', () => {
  it('缺省与脏输入保留真实渲染基线，返回独立的完整对象', () => {
    for (const value of [undefined, null, [], 'large', 12]) {
      expect(normalizeChatTypography(value)).toEqual(CHAT_TYPOGRAPHY_DEFAULTS);
      expect(normalizeChatTypography(value)).not.toBe(CHAT_TYPOGRAPHY_DEFAULTS);
    }
    expect(CHAT_TYPOGRAPHY_DEFAULTS.body).toEqual({ fontSize: 15, fontWeight: 400 });
    expect(CHAT_TYPOGRAPHY_DEFAULTS.headings).toEqual({ fontSize: 18, fontWeight: 600 });
    expect(CHAT_TYPOGRAPHY_DEFAULTS.codeBlock.fontSize).toBe(11);
    expect(CHAT_TYPOGRAPHY_DEFAULTS.inlineCode.fontSize).toBe(11);
  });

  it('逐字段降级，不截断、不转换字符串、不接受非有限数或非整数', () => {
    expect(
      normalizeChatTypography({
        body: { fontSize: 20, fontWeight: '700' },
        headings: { fontSize: Infinity, fontWeight: 700 },
        table: { fontSize: 7, fontWeight: 450 },
        codeBlock: { fontSize: 12.5, fontWeight: 900 },
        inlineCode: null,
        malicious: 'var(--shell-size)',
      })
    ).toEqual({
      ...CHAT_TYPOGRAPHY_DEFAULTS,
      body: { fontSize: 20, fontWeight: 400 },
      headings: { fontSize: 18, fontWeight: 700 },
      codeBlock: { fontSize: 11, fontWeight: 900 },
    });
  });

  it('导入仅接受完整对象、允许的字重和8到32的整数字号，拒绝额外键', () => {
    for (const size of [8, 32]) {
      const value = normalizeChatTypography({ body: { fontSize: size, fontWeight: 100 } });
      expect(parseChatTypography(value)).toEqual(value);
    }
    for (const size of [7, 33, NaN, Infinity, 14.5, '16', 'calc(100vw)']) {
      expect(
        parseChatTypography({
          ...CHAT_TYPOGRAPHY_DEFAULTS,
          body: { fontSize: size, fontWeight: 400 },
        })
      ).toBeNull();
    }
    for (const value of [
      {},
      null,
      [],
      { ...CHAT_TYPOGRAPHY_DEFAULTS, shell: 99 },
      { ...CHAT_TYPOGRAPHY_DEFAULTS, table: { fontSize: 15, fontWeight: 450 } },
      { ...CHAT_TYPOGRAPHY_DEFAULTS, body: { fontSize: 15, fontWeight: 400, style: 'evil' } },
    ]) {
      expect(parseChatTypography(value)).toBeNull();
    }
    expect(CHAT_TYPOGRAPHY_PARTS).toHaveLength(5);
  });

  it('CSS只描述聊天比例，正文与表格独立缩放，不改变shell字号', () => {
    const vars = chatTypographyVariables(
      normalizeChatTypography({ body: { fontSize: 30 }, table: { fontSize: 15 } })
    );
    expect(vars['--chat-body-scale']).toBe('2');
    expect(vars['--chat-table-relative-scale']).toBe('0.5');
    expect(vars['--chat-table-header-weight']).toBe('500');
    expect(Object.keys(vars).every((key) => key.startsWith('--chat-'))).toBe(true);
    expect(Object.values(chatTypographyVariables(CHAT_TYPOGRAPHY_DEFAULTS))).not.toContain('NaN');
  });
});
