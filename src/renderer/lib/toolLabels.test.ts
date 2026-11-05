import { getTranslation, zhTranslations } from '@shared/i18n';
import { describe, expect, it } from 'vitest';
import { SUBAGENT_OP_LABEL_KEYS, TOOL_LABEL_KEYS, toolLabel } from './toolLabels';

const zh = (key: string) => getTranslation('zh', key);

describe('toolLabel', () => {
  it('已命名工具显示本地化名，未命名工具回退原始 id', () => {
    expect(toolLabel('explore_mark', zh)).toBe('开始探索');
    expect(toolLabel('browser_navigate', zh)).toBe('浏览器 · 打开');
    expect(toolLabel('bash', zh)).toBe('bash');
  });

  it('脚本工具编排统一命名，兼容历史 exec 工具记录', () => {
    for (const name of ['codemode', 'exec']) {
      expect(toolLabel(name, zh)).toBe('脚本工具编排');
      expect(toolLabel(name, (key) => getTranslation('en', key))).toBe('Script orchestration');
    }
  });

  it('映射表里的词条都有中文', () => {
    for (const key of [
      ...Object.values(TOOL_LABEL_KEYS),
      ...Object.values(SUBAGENT_OP_LABEL_KEYS),
    ]) {
      expect(zhTranslations[key as string], key).toBeTypeOf('string');
    }
  });
});
