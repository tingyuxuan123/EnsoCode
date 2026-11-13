import type { ThemeAsset, ThemeAssetSlot, ThemeAssets, ThemeBackground } from './types';

const slots: readonly ThemeAssetSlot[] = [
  'canvas-pattern',
  'sidebar-footer',
  'empty-main',
  'welcome',
  'composer-peek',
  'thinking',
  'code-corner',
  'todo-corner',
  'status-icon',
  'panel-corner',
];
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function isThemeAssetPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\\:%?#"'()<>\s]/.test(value) &&
    value.split('/').every((p) => p !== '' && p !== '.' && p !== '..') &&
    /\.(png|jpg|jpeg|gif|webp|bmp|svg|jfif|avif)$/i.test(value)
  );
}
function asset(raw: unknown): ThemeAsset | null {
  if (!record(raw) || !isThemeAssetPath(raw.src)) return null;
  const out: ThemeAsset = { src: raw.src };
  for (const key of ['still', 'dark'] as const) {
    if (raw[key] === undefined) continue;
    if (!isThemeAssetPath(raw[key])) return null;
    out[key] = raw[key];
  }
  if (raw.states !== undefined) {
    if (!record(raw.states)) return null;
    out.states = {};
    for (const [key, value] of Object.entries(raw.states)) {
      if ((key !== 'running' && key !== 'waiting' && key !== 'error') || !isThemeAssetPath(value))
        return null;
      out.states[key] = value;
    }
  }
  return out;
}
export function parseThemeAssets(raw: unknown): ThemeAssets | undefined {
  if (!record(raw)) return;
  const out: ThemeAssets = {};
  for (const slot of slots) {
    const value = asset(raw[slot]);
    if (value) out[slot] = value;
  }
  return Object.keys(out).length ? out : undefined;
}
export function parseThemeBackground(raw: unknown): ThemeBackground | undefined {
  if (!record(raw)) return;
  const image = asset(raw.image);
  if (!image) return;
  const out: ThemeBackground = { image };
  if (
    raw.size === 'cover' ||
    raw.size === 'contain' ||
    raw.size === 'repeat' ||
    raw.size === 'center'
  )
    out.size = raw.size;
  for (const [key, max] of [
    ['blur', 20],
    ['brightness', 2],
    ['saturation', 2],
    ['mask', 1],
    ['opacity', 1],
    ['composerOpacity', 1],
    ['codeOpacity', 1],
  ] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value))
      out[key] = Math.min(max, Math.max(0, value));
  }
  return out;
}
function mapAsset(value: ThemeAsset, toUrl: (rel: string) => string): ThemeAsset {
  return {
    src: toUrl(value.src),
    ...(value.still ? { still: toUrl(value.still) } : {}),
    ...(value.dark ? { dark: toUrl(value.dark) } : {}),
    ...(value.states
      ? {
          states: Object.fromEntries(
            Object.entries(value.states).map(([key, rel]) => [key, toUrl(rel)])
          ),
        }
      : {}),
  };
}
export function resolveThemeAssets(
  value: ThemeAssets,
  path: string,
  toUrl: (rel: string) => string
): ThemeAssets {
  const base = path.split('/').slice(0, -1);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      mapAsset(item, (rel) => toUrl([...base, rel].join('/'))),
    ])
  );
}
export function resolveThemeBackground(
  value: ThemeBackground,
  path: string,
  toUrl: (rel: string) => string
): ThemeBackground {
  const base = path.split('/').slice(0, -1);
  return { ...value, image: mapAsset(value.image, (rel) => toUrl([...base, rel].join('/'))) };
}
const cssUrl = (url: string) => `url("${url.replace(/["\\\n\r\f]/g, encodeURIComponent)}")`;
const overlay = (slot: string, box: string) =>
  `content:"";position:absolute;pointer-events:none;${box};background:var(--enso-asset-${slot}) center / contain no-repeat`;
const SLOT_RULES: Record<ThemeAssetSlot, string> = {
  'canvas-pattern': `[data-enso="canvas"]{position:relative;isolation:isolate}[data-enso="canvas"]::before{${overlay('canvas-pattern', 'inset:0;z-index:-1')};background-repeat:repeat}`,
  'sidebar-footer':
    '[data-enso="sidebar"]{background:var(--enso-asset-sidebar-footer) no-repeat center bottom 64px / min(150px,80%) auto}',
  'empty-main':
    '[data-enso="main"]:not(:has([data-enso="timeline"])){background:var(--enso-asset-empty-main) no-repeat center calc(50% - 130px) / 170px auto,var(--background)}',
  welcome: `[data-enso="timeline"]:not(:has([data-enso="message-user"]))::after{${overlay('welcome', 'right:24px;bottom:12px;width:132px;height:132px')}}`,
  'composer-peek': `[data-enso="composer"]{position:relative;isolation:isolate}[data-enso="composer"]::before{${overlay('composer-peek', 'right:72px;bottom:calc(100% - 4px);width:84px;height:66px;z-index:-1')}}`,
  thinking: `[data-enso="thinking"]{position:relative;padding-left:36px}[data-enso="thinking"]::before{${overlay('thinking', 'left:-2px;top:-8px;width:34px;height:34px')}}[data-enso="thinking"]:not([data-live])::before{background-image:var(--enso-asset-thinking-still,var(--enso-asset-thinking))}`,
  'code-corner': `[data-enso="code-block"]::after{${overlay('code-corner', 'right:20px;top:-13px;width:24px;height:24px;z-index:1')}}`,
  'todo-corner': `[data-enso="todo"]{position:relative}[data-enso="todo"]::after{${overlay('todo-corner', 'right:6px;top:-30px;width:44px;height:44px')}}`,
  'status-icon': `[data-enso="status-line"]::before{${overlay('status-icon', 'left:2px;top:50%;width:20px;height:20px;translate:0 -50%')}}`,
  'panel-corner': `[data-enso="side-panel"]{position:relative}[data-enso="side-panel"]::after{${overlay('panel-corner', 'right:10px;bottom:10px;width:72px;height:72px;opacity:0.9;z-index:5')}}`,
};
/** 只为解析后的固定素材槽生成规则；没有素材时不触碰现有 Collabra 样式。 */
export function themeAssetsCss(
  assets: ThemeAssets | undefined,
  background?: ThemeBackground
): string {
  const base: string[] = [],
    dark: string[] = [],
    still: string[] = [],
    states: string[] = [],
    rules: string[] = [];
  const add = (slot: string, value: ThemeAsset, attr: 'activity' | 'session') => {
    const name = `--enso-asset-${slot}`;
    base.push(`${name}:${cssUrl(value.src)}`);
    if (value.dark) dark.push(`${name}:${cssUrl(value.dark)}`);
    if (value.still) {
      still.push(`${name}:${cssUrl(value.still)}`);
      if (slot === 'thinking') base.push(`${name}-still:${cssUrl(value.still)}`);
    }
    for (const state of ['running', 'waiting', 'error'] as const) {
      const url = value.states?.[state];
      if (url) states.push(`:root[data-enso-${attr}="${state}"]{${name}:${cssUrl(url)}}`);
    }
  };
  for (const slot of slots) {
    const value = assets?.[slot];
    if (!value) continue;
    add(
      slot,
      value,
      ['canvas-pattern', 'sidebar-footer', 'empty-main'].includes(slot) ? 'activity' : 'session'
    );
    rules.push(SLOT_RULES[slot]);
  }
  if (background) {
    add('background', background.image, 'activity');
    const size =
      background.size === 'contain'
        ? 'contain'
        : background.size === 'repeat' || background.size === 'center'
          ? 'auto'
          : 'cover';
    const repeat = background.size === 'repeat' ? 'repeat' : 'no-repeat';
    const opacity = background.opacity ?? 0.85;
    rules.push(
      `[data-enso="canvas"]{position:relative;isolation:isolate}[data-enso="canvas"]::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:var(--enso-asset-background) center / ${size} ${repeat};filter:blur(${background.blur ?? 0}px) brightness(${background.brightness ?? 1}) saturate(${background.saturation ?? 1});opacity:${opacity}}`
    );
  }
  if (!base.length) return '';
  return [
    `:root{${base.join(';')}}`,
    dark.length ? `:root.dark{${dark.join(';')}}` : '',
    still.length
      ? `@media (prefers-reduced-motion:reduce){:root,:root.dark{${still.join(';')}}}`
      : '',
    ...states,
    ...rules,
  ]
    .filter(Boolean)
    .join('\n');
}
