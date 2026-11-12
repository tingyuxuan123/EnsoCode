import { describe, expect, it } from 'vitest';
import { imageGenerationRouting } from './imageGenerationRouting';

describe('图片与设计画布的模型路由提示', () => {
  it('未配置、禁用或受权限限制的会话不宣称具有生图工具', () => {
    expect(imageGenerationRouting(new Set(['vetd_create', 'read']))).toBeUndefined();
  });
  it('生图可用时，画一张海报默认输出图片，只有显式可编辑交付才走画布', () => {
    const text = imageGenerationRouting(new Set(['generate_image', 'vetd_create']))!;
    expect(text).toContain('generate_image');
    expect(text).toContain('4K 16:9');
    expect(text).toContain('3840x2160');
    expect(text).toContain('editable');
    expect(text).toContain('not vetd_create');
    expect(text).not.toContain('Use edit_image');
  });
  it('只暴露已启用的改图能力，不暗示未授权的生图能力', () => {
    const text = imageGenerationRouting(new Set(['edit_image']))!;
    expect(text).toContain('Use edit_image');
    expect(text).not.toContain('Use generate_image');
  });
});
