import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const shared = readFileSync(new URL('./shared.css', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const phone = readFileSync(
  new URL('../../../packages/phone/src/styles.css', import.meta.url),
  'utf8'
);

const decls = (css: string, selector: string) => {
  const result: Record<string, string> = {};
  postcss.parse(css).walkRules(selector, (rule) => {
    rule.walkDecls((decl) => {
      result[decl.prop] = decl.value;
    });
  });
  return result;
};

describe('persistent selection colour contract', () => {
  it.each([
    ['desktop', desktop],
    ['phone', phone],
  ])('%s dark utilities follow the application class, not OS media', async (_, css) => {
    const generated = (
      await compile(`${shared}\n${css.replace(/^@import.*$/gm, '')}\n@tailwind utilities;`)
    ).build(['dark:bg-brand/15']);
    // Test the compiled selector, not only the presence of a configuration directive.
    expect(generated).toContain(':where(.dark, .dark *)');
    expect(generated).not.toContain('prefers-color-scheme');
  });

  it('keeps persistent selection neutral in both modes, never brand-tinted', async () => {
    const tokens = decls(shared, ':root');
    const dark = decls(shared, '.dark');
    // Kettu 的选中块是黑/白叠色加细线，橙只留给发送、开关与焦点环。
    expect(tokens['--selection']).toBe('rgb(0 0 0 / 6%)');
    expect(dark['--selection']).toBe('rgb(255 255 255 / 8%)');
    expect(tokens['--selection-foreground']).toBe('var(--foreground)');
    expect(tokens['--selection-border']).toBe('rgb(0 0 0 / 16%)');
    expect(dark['--selection-border']).toBe('rgb(255 255 255 / 18%)');
    const generated = (await compile(`${shared}\n@tailwind utilities;`)).build([
      'bg-selection',
      'text-selection-foreground',
      'border-selection-border',
    ]);
    expect(decls(generated, '.bg-selection')['background-color']).toBe('var(--color-selection)');
    expect(decls(generated, '.text-selection-foreground').color).toBe(
      'var(--color-selection-foreground)'
    );
    expect(decls(generated, '.border-selection-border')['border-color']).toBe(
      'var(--color-selection-border)'
    );
    const wallpaper = decls(desktop, 'html.bg-image-enabled');
    for (const key of [
      '--color-selection',
      '--selection',
      '--selection-foreground',
      '--selection-border',
    ]) {
      expect(wallpaper[key], `${key} must not inherit panel alpha`).toBeUndefined();
    }
  });

  it('does not alias upstream primary or neutral hover to the selection colour', () => {
    const dark = decls(desktop, '.dark');
    expect(dark['--primary']).toBe('var(--foreground)');
    expect(dark['--accent']).toBe('rgb(255 255 255 / 6%)');
  });

  it.each([
    ['Sidebar.tsx', /active\s*\?\s*'([^']*bg-[^']+)'/],
    ['PresetPicker.tsx', /selected\s*\?\s*'([^']+)'/],
    ['WorktreePicker.tsx', /option\.selected\s*\?\s*'([^']+)'/],
    ['ApprovalModePicker.tsx', /selected\s*\?\s*'([^']+)'/],
    ['PlanBar.tsx', /option === approvalMode\s*\?\s*'([^']+)'/],
    ['ImportSessionDialog.tsx', /selected\?\.path === session\.path\s*\?\s*'([^']+)'/],
    ['GroupChips.tsx', /selected\s*\?\s*'([^']+)'/],
    ['PlanModeToggle.tsx', /active\s*\?\s*'([^']+)'/],
    ['AskUserResult.tsx', /selected\s*\?\s*'([^']+)'/],
  ])('%s persistent choices compile to the shared selection surface', async (file, expression) => {
    let source = readFileSync(new URL(`../components/chat/${file}`, import.meta.url), 'utf8');
    if (file === 'Sidebar.tsx')
      source = source.slice(source.indexOf('data-slot="conversation-row"'));
    const classes = source.match(expression)?.[1] ?? '';
    expect(classes, 'selected branch').not.toBe('');
    const background = classes.split(/\s+/).find((entry) => entry.startsWith('bg-')) ?? '';
    const generated = (
      await compile(`${shared}\n${desktop.replace(/^@import.*$/gm, '')}\n@tailwind utilities;`)
    ).build([background]);
    const selector = `.${background.replace(/([^\w-])/g, '\\$1')}`;
    expect(decls(generated, selector)['background-color']).toBe('var(--color-selection)');
  });

  it.each(['ModelPicker.tsx', 'PresetPicker.tsx', 'WorktreePicker.tsx', 'WorkspaceBranchList.tsx'])(
    '%s selected check marks follow brand rather than neutral primary',
    async (file) => {
      const source = readFileSync(new URL(`../components/chat/${file}`, import.meta.url), 'utf8');
      const check = source.match(/<Check className="([^"]+)"/)?.[1] ?? '';
      const text = check.split(/\s+/).find((c) => c.startsWith('text-')) ?? '';
      const generated = (
        await compile(`${shared}\n${desktop.replace(/^@import.*$/gm, '')}\n@tailwind utilities;`)
      ).build([text]);
      expect(decls(generated, `.${text}`).color).toBe('var(--color-brand)');
    }
  );
});
