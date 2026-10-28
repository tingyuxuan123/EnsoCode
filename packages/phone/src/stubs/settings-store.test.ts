import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';

/**
 * 桩与共享组件的契约：被复用的桌面组件从 `useSettingsStore` 读到的每个设置键，
 * 桩的初始 state 都必须有定义值。漏一个就是渲染期 `undefined.enabled` 级崩溃
 * （整页白屏，无错误边界兜底），而桌面侧测试全绿。
 */

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const phoneSrc = path.join(repoRoot, 'packages/phone/src');

/** 构建期被 vite alias 换成桩的模块：真实实现不进 PWA，不参与记账 */
const STUBBED = [
  /^@\/i18n$/,
  /^@\/stores\/settings$/,
  /^@\/stores\/sessions$/,
  /^@\/lib\/ghosttyTheme$/,
];

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveSpec(spec: string, fromFile: string): string | null {
  if (STUBBED.some((re) => re.test(spec))) return null;
  let base: string;
  if (spec.startsWith('@/')) base = path.join(repoRoot, 'src/renderer', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/import\s+(?!type\b)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);
}

/** `useSettingsStore((s) => s.foo)` / `((state) => state.foo)` 里的 foo */
function selectorKey(argument: string): string | null {
  const body = argument.match(/=>\s*([\s\S]*)$/)?.[1];
  if (!body) return null;
  return body.match(/^\s*\(?\s*[\w$]+\s*\.\s*([\w$]+)/)?.[1] ?? null;
}

/** 只认 `useSettingsStore(` 与 `useSettingsStore.getState().key` 两种入口，其余写法漏扫即视为未覆盖 */
function matchAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function settingsKeysRead(source: string): string[] {
  const keys = matchAll(source, /useSettingsStore\s*\.\s*getState\(\)\s*\.\s*([\w$]+)/g);
  const call = /useSettingsStore\s*\(/g;
  let start = call.exec(source);
  while (start !== null) {
    let depth = 1;
    let index = start.index + start[0].length;
    for (; index < source.length && depth > 0; index++) {
      if (source[index] === '(') depth++;
      else if (source[index] === ')') depth--;
    }
    const key = selectorKey(source.slice(start.index + start[0].length, index - 1));
    if (key) keys.push(key);
    start = call.exec(source);
  }
  return keys;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

function bundledSettingsKeys(): Set<string> {
  const pending = sourceFiles(phoneSrc);
  const visited = new Set<string>();
  const keys = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (visited.has(file)) continue;
    if (!/\.(ts|tsx)$/.test(file) || /\.test\.(ts|tsx)$/.test(file)) continue;
    if (file.startsWith(path.join(phoneSrc, 'stubs'))) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const key of settingsKeysRead(source)) keys.add(key);
    for (const spec of importsOf(source)) {
      const resolved = resolveSpec(spec, file);
      if (resolved) pending.push(resolved);
    }
  }
  return keys;
}

it('PWA 设置桩定义了所有被打包组件读取的设置键', () => {
  const keys = bundledSettingsKeys();
  // 扫描失效（导入图没走通）时不要静默通过
  expect(keys.size).toBeGreaterThan(5);
  const state: Record<string, unknown> = { ...useSettingsStore.getState() };
  const missing = [...keys].filter((key) => state[key] === undefined);
  expect(missing).toEqual([]);
});
