import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./kettuLight.css', import.meta.url), 'utf8');
const root = postcss.parse(css);
const scope = "html[data-light-palette='kettu-light']";

function declarations(selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  root.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

const tokens = declarations(scope);

function resolve(value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const token = tokens[name] ?? tokens[name.replace('--color-', '--')];
    if (!token) throw new Error(`Missing kettu token: ${name}`);
    return resolve(token);
  });
}

describe('Kettu 浅色（默认方案）', () => {
  it('uses the Kettu light desk, sheets and hairlines', () => {
    // 本地期望值：回归测试不读 Kettu 检出目录。
    expect(tokens).toMatchObject({
      '--shell': '#f8f8f8',
      '--panel': '#ffffff',
      '--background': '#ffffff',
      '--card': '#ffffff',
      '--popover': '#ffffff',
      '--foreground': '#1f1f1f',
      '--secondary': '#f4f4f5',
      '--muted': '#f4f4f5',
      '--muted-foreground': '#5c5c5c',
      '--accent': 'rgb(0 0 0 / 4%)',
      '--border': 'rgb(0 0 0 / 10%)',
      '--input': 'rgb(0 0 0 / 16%)',
    });
    expect(declarations(`${scope}:not(.bg-image-enabled)`)['--color-nav']).toBe('#f8f8f8');
  });

  it('keeps primary as the ink like the dark sheet and never pins --brand', () => {
    // --primary 在宿主里是强调图标与实心主操作色，不是"控件蓝"：Kettu 把蓝色留给控件，
    // CodeKiln 的控件走强调色，所以这里跟深色一样取墨色，避免整屏蓝色图标。
    expect(resolve(tokens['--primary'])).toBe('#1f1f1f');
    expect(resolve(tokens['--primary-foreground'])).toBe('#ffffff');
    expect(tokens['--ring']).toBe('var(--brand)');
    // 强调色由 html[data-accent] 决定，方案自己的 --brand 必须让位。
    expect(tokens).not.toHaveProperty('--brand');
    expect(tokens).not.toHaveProperty('--brand-foreground');
  });

  it('drops the accent border from an inactive send control', () => {
    const inactive = declarations(`${scope} [data-slot='composer'] button.bg-brand:disabled`);
    expect(inactive['background-color']).toBe('rgb(0 0 0 / 6%)');
    expect(inactive['border-color']).toBe('transparent');
    expect(resolve(inactive.color)).toBe('#949494');
  });

  it('uses status colours that read on the white sheet', () => {
    expect(tokens).toMatchObject({
      '--destructive': '#ac3b2d',
      '--destructive-foreground': '#ffffff',
      '--success': '#2e7550',
      '--success-foreground': '#ffffff',
      '--warning': '#936600',
      '--warning-foreground': '#ffffff',
      '--info': '#48525f',
      '--info-foreground': '#ffffff',
    });
  });

  it('keeps the tight Kettu radius scale and its two-layer shadows', () => {
    expect(tokens['--radius']).toBe('5px');
    expect(tokens['--radius-xl']).toBe('8px');
    expect(tokens['--radius-2xl']).toBe('10px');
    expect(tokens['--radius-3xl']).toBe('10px');
    expect(tokens['--elevation-float']).toBe(
      '0 0 0 0.5px rgb(0 0 0 / 6%), 0 10px 24px -10px rgb(0 0 0 / 14%)'
    );
  });

  it('scopes every override to the opt-in palette and preserves wallpaper navigation', () => {
    root.walkRules((rule) => {
      expect(rule.selector.startsWith(scope), rule.selector).toBe(true);
      if (rule.nodes.some((node) => node.type === 'decl' && node.prop === '--color-nav')) {
        expect(rule.selector).toContain(':not(.bg-image-enabled)');
      }
    });
  });

  it('changes only the skin, never sizes', () => {
    for (const styles of [
      tokens,
      declarations(`${scope} [data-slot='project-sidebar'] [data-slot='tabs-list']`),
      declarations(`${scope} [data-slot='project-sidebar'] [data-slot='tab-indicator']`),
      declarations(`${scope} [data-slot='settings-window'] button[aria-pressed='true'].border-2`),
    ]) {
      for (const property of ['height', 'width', 'padding', 'margin', 'font-size']) {
        expect(styles[property], property).toBeUndefined();
      }
    }
  });
});
