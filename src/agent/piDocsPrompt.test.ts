import { describe, expect, it } from 'vitest';
// pi 未从入口导出 buildSystemPrompt；直接渲染真实提示词，作为“同名 section 覆盖内置段”的升级复检点
import { buildSystemPrompt } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import { applyPiDocsAvailability } from './piDocsPrompt';

const base = () => ({ cwd: '/w', sections: {} as Record<string, string> });

describe('applyPiDocsAvailability', () => {
  it('打包版没有 pi 文档：docs 段不再指向不存在的路径', () => {
    const options = base();
    applyPiDocsAvailability(options, false);
    const prompt = buildSystemPrompt(options);
    expect(prompt).toContain('<docs>');
    expect(prompt).not.toContain('Main documentation:');
    expect(prompt).not.toContain('docs/extensions.md');
    expect(prompt).toMatch(/not bundled/);
  });

  it('文档在磁盘上（开发环境）：保留 pi 默认 docs 段', () => {
    const options = base();
    applyPiDocsAvailability(options, true);
    expect(buildSystemPrompt(options)).toContain('Main documentation:');
  });

  it('自定义整段提示词的会话本来没有 docs 段，不额外塞进去', () => {
    const options = { ...base(), customPrompt: 'You are a reviewer.' };
    applyPiDocsAvailability(options, false);
    expect(buildSystemPrompt(options)).not.toContain('<docs>');
  });
});
