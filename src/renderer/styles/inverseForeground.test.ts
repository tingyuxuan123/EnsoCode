import { readFileSync } from 'node:fs';
import { compile } from 'tailwindcss';
import { describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '@/components/ui/button';
import { applyTerminalThemeToApp } from '@/lib/ghosttyTheme';

const shared = readFileSync(new URL('./shared.css', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const phone = readFileSync(
  new URL('../../../packages/phone/src/styles.css', import.meta.url),
  'utf8'
);
const composer = readFileSync(new URL('../components/chat/Composer.tsx', import.meta.url), 'utf8');
const groups = readFileSync(new URL('../components/chat/GroupChips.tsx', import.meta.url), 'utf8');
const timeline = readFileSync(
  new URL('../components/chat/TimelineRow.tsx', import.meta.url),
  'utf8'
);

interface CssRule {
  selector: string;
  body: string;
  media: string[];
}

function rules(css: string, media: string[] = []): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(?:import|layer)[^{;]*;/g, '');
  const result: CssRule[] = [];
  let start = 0;
  while (start < clean.length) {
    const open = clean.indexOf('{', start);
    if (open < 0) break;
    const selector = clean.slice(start, open).trim();
    let end = open + 1;
    let depth = 1;
    while (end < clean.length && depth > 0) {
      if (clean[end] === '{') depth++;
      if (clean[end] === '}') depth--;
      end++;
    }
    const body = clean.slice(open + 1, end - 1);
    if (body.includes('{')) {
      result.push(...rules(body, selector.startsWith('@media') ? [...media, selector] : media));
    } else {
      result.push({ selector, body, media });
    }
    start = end;
  }
  return result;
}

function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])
  );
}

function variables(css: string, selector: string): Record<string, string> {
  return declarations(rules(css).find((rule) => rule.selector === selector)?.body ?? '');
}

function resolve(value: string, tokens: Record<string, string>): string {
  return value.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name, fallback) => {
    const next = tokens[name] ?? fallback;
    if (next === undefined) throw new Error(`Missing CSS token ${name}`);
    return resolve(next, tokens);
  });
}

async function utility(classes: string, property: string, css = desktop): Promise<string> {
  const source = `${shared}\n${css.replace(/^@import.*$/gm, '')}\n@tailwind utilities;`;
  const generated = (await compile(source)).build(classes.split(/\s+/));
  const candidate = classes.split(/\s+/).findLast((entry) => {
    const rule = rules(generated).find((item) => item.selector === `.${entry}`);
    return rule && declarations(rule.body)[property] !== undefined;
  });
  const rule = rules(generated).find((item) => item.selector === `.${candidate}`);
  if (!rule) throw new Error(`Missing generated ${property} utility for ${classes}`);
  return declarations(rule.body)[property];
}

function terminalVariables(name: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  vi.stubGlobal('document', {
    documentElement: {
      classList: { toggle: () => undefined },
      style: {
        setProperty: (key: string, value: string) => {
          tokens[key] = value;
        },
      },
    },
  });
  try {
    applyTerminalThemeToApp(name);
    return tokens;
  } finally {
    vi.unstubAllGlobals();
  }
}

function luminance(color: string): number {
  let rgb: number[];
  if (color.startsWith('#')) {
    rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  } else if (color.startsWith('rgb(')) {
    rgb = [...color.matchAll(/[\d.]+/g)].map((match) => Number(match[0]) / 255);
  } else {
    const [l, c, h] = [...color.matchAll(/[\d.]+/g)].map((match) => Number(match[0]));
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return (
      0.2126 * (4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss) +
      0.7152 * (-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss) +
      0.0722 * (-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss)
    );
  }
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

const inverseControls = [
  { name: 'default Button', classes: buttonVariants() },
  { name: 'selected group', classes: groups.match(/\?\s*'([^']*bg-foreground[^']*)'/)?.[1] ?? '' },
  {
    name: 'Composer stop',
    classes: composer.match(/className="([^"]*border-foreground[^"]*)"/)?.[1] ?? '',
  },
];

describe('opaque inverse control foreground', () => {
  it.each(inverseControls)(
    '$name stays opaque while panel alpha follows the wallpaper setting',
    async ({ classes }) => {
      for (const [name, css, raw] of [
        ['desktop light', desktop, variables(desktop, ':root')],
        [
          'desktop dark',
          desktop,
          { ...variables(desktop, ':root'), ...variables(desktop, '.dark') },
        ],
        ['phone light', phone, variables(phone, ':root')],
        ['phone dark', phone, { ...variables(phone, ':root'), ...variables(phone, '.dark') }],
        ['sync-terminal dark', desktop, terminalVariables('Dracula')],
        ['sync-terminal light', desktop, terminalVariables('GitHub Light Default')],
      ] as const) {
        const foreground = await utility(classes, 'color', css);
        const background = await utility(classes, 'background-color', css);
        const compiled = (
          await compile(`${shared}\n${css.replace(/^@import.*$/gm, '')}\n@tailwind utilities;`)
        ).build(classes.split(/\s+/));
        for (const alpha of [0, 1]) {
          const tokens = {
            ...variables(compiled, ':root, :host'),
            ...variables(desktop, 'html.bg-image-enabled'),
            ...raw,
            '--bg-panel-alpha': String(alpha),
          };
          // Resolving the generated utility catches alpha remapping, not only a class-name change.
          expect(resolve(foreground, tokens), `${name}, panel alpha ${alpha}`).toBe(
            raw['--background']
          );
          expect(resolve(background, tokens)).toBe(raw['--foreground']);
          const a = luminance(resolve(foreground, tokens));
          const b = luminance(resolve(background, tokens));
          expect(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            `${name} text contrast`
          ).toBeGreaterThanOrEqual(4.5);
          expect(resolve('var(--color-background)', tokens)).toContain(`/ ${alpha})`);
        }
      }
    }
  );

  it('Composer send and focus still resolve the selected accent rather than primary', async () => {
    const send = composer.match(/className="([^"]*disabled:opacity-35[^"]*)"/)?.[1] ?? '';
    const value = await utility(send, 'background-color');
    const tokens = {
      '--color-brand': 'var(--brand)',
      '--brand': '#7c4ed6',
      '--color-primary': '#408abf',
    };
    expect(resolve(value, tokens)).toBe('#7c4ed6');
    const focus = composer.match(/focus-within:border-[\w/-]+/)?.[0] ?? '';
    const css = (
      await compile(`${shared}\n@theme {--color-primary:var(--primary)}\n@tailwind utilities;`)
    ).build([focus]);
    const focusRule = css.slice(css.lastIndexOf('.focus-within'));
    const border = focusRule.match(/border-color:\s*([^;]+);/)?.[1] ?? '';
    expect(resolve(border, { ...tokens, '--primary': '#408abf' })).toBe('#7c4ed6');
  });
});

it('user message metadata hides only on hover-capable devices, keeping touch controls visible', async () => {
  const source = timeline.slice(
    timeline.indexOf('function UserMeta('),
    timeline.indexOf('function TextRow(')
  );
  const classes = [...source.matchAll(/['"]([^'"\n]*opacity[^'"\n]*)['"]/g)].flatMap((match) =>
    match[1].split(/\s+/)
  );
  const generated = rules((await compile('@tailwind utilities;')).build(classes));
  const hidden = generated.filter((rule) => /opacity:\s*0%;/.test(rule.body));
  expect(hidden.length).toBeGreaterThan(0);
  for (const rule of hidden) {
    expect(
      rule.media.some((media) => /\(hover:\s*hover\)/.test(media)),
      rule.selector
    ).toBe(true);
  }
  expect(
    generated.some(
      (rule) => rule.selector.endsWith(':focus-within') && /opacity:\s*100%;/.test(rule.body)
    )
  ).toBe(true);
});
