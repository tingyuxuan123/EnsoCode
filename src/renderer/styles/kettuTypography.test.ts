import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(readFileSync(new URL('./globals.css', import.meta.url), 'utf8'));

function declarations(selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  root.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

describe('Kettu 桌面默认字体', () => {
  it('使用同款 Inter 光学字号、真实斜体与离线 JetBrains Mono', () => {
    const imports: string[] = [];
    root.walkAtRules('import', (rule) => {
      imports.push(rule.params.replaceAll('"', '').replaceAll("'", ''));
    });
    expect(imports).toEqual(
      expect.arrayContaining([
        '@fontsource-variable/inter/opsz.css',
        '@fontsource-variable/inter/opsz-italic.css',
        '@fontsource-variable/jetbrains-mono/wght.css',
      ])
    );
    const tokens = declarations(':root');
    expect(tokens['--font-family-sans']).toMatch(/^"Inter Variable", "Platform Chinese",/);
    expect(tokens['--font-family-mono']).toMatch(/^"JetBrains Mono Variable",/);
  });

  it('界面默认 13px，但保留 14px 根字号以免改变已有 rem 布局与缩放', () => {
    expect(declarations(':root')['--font-size-base']).toBe('14px');
    expect(declarations('html')['font-size']).toBe('var(--font-size-base)');
    const body = declarations('body');
    expect(body['font-size']).toBe('calc(13rem / 14)');
    expect(body['font-feature-settings']).toBe('"cv11"');
    expect(body['line-height']).toBe('1.4');
  });

  it('中文按 Kettu 的 Regular、Medium、Semibold 档位匹配平台字体', () => {
    const faces: Record<string, string>[] = [];
    root.walkAtRules('font-face', (rule) => {
      const face: Record<string, string> = {};
      rule.walkDecls((declaration) => {
        face[declaration.prop] = declaration.value;
      });
      if (face['font-family'] === '"Platform Chinese"') faces.push(face);
    });
    expect(faces.map((face) => face['font-weight'])).toEqual(['300 449', '450 549', '550 700']);
    for (const [index, weight] of ['Regular', 'Medium', 'Semibold'].entries()) {
      expect(faces[index].src).toContain(`local("PingFang SC ${weight}")`);
      expect(faces[index].src).toContain('Microsoft YaHei');
      expect(faces[index].src).toContain('Noto Sans CJK SC');
    }
  });

  it('桌面输入框使用 15px，未定义桌面变量的手机保留原来的 1rem', () => {
    expect(declarations(':root')['--composer-font-size']).toBe('calc(15rem / 14)');
    const composer = readFileSync(
      new URL('../components/chat/Composer.tsx', import.meta.url),
      'utf8'
    );
    expect(composer).toContain('text-[length:var(--composer-font-size,1rem)]');
  });
});
