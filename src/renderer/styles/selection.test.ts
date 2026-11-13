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

  it('derives persistent fill, foreground and border from raw theme colours', async () => {
    const tokens = decls(shared, ':root');
    const dark = decls(shared, '.dark');
    expect(tokens['--selection']).toBe('color-mix(in oklch, var(--brand) 12%, transparent)');
    expect(dark['--selection']).toBe('color-mix(in oklch, var(--brand) 18%, transparent)');
    expect(tokens['--selection-foreground']).toBe('var(--foreground)');
    expect(tokens['--selection-border']).toBe('color-mix(in oklch, var(--brand) 45%, transparent)');
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
    expect(dark['--accent']).toBe('color-mix(in oklch, var(--foreground) 6%, transparent)');
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
