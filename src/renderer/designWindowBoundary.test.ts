import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * 独立设计窗口与主窗口同源，sessions / sidePanel store 又持久化到 settings.json：
 * 设计窗口一旦导入它们，就会水合出一份会话快照并在 setState 时写回，覆盖主窗口的
 * 会话元数据（真机验证中出现过主窗口 activeId 被改写）。这里静态遍历入口的运行时
 * 依赖（含动态 import，跳过会被擦除的 type-only 导入），确保这些模块永远不会进入设计窗口。
 */
const renderer = path.resolve(__dirname);
const aliases: Array<[string, string]> = [
  ['@vetta-org/plugin-sdk', path.join(renderer, 'features/design/host/sdk.ts')],
  ['@shared/', `${path.resolve(renderer, '../shared')}/`],
  ['@/', `${renderer}/`],
];
const FORBIDDEN = [
  'stores/sessions/index.ts',
  'stores/sidePanel/index.ts',
  'lib/sidePanelDock.ts',
  'features/design/host/main-host.ts',
];

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string | null = null;
  for (const [prefix, target] of aliases)
    if (spec === prefix || spec.startsWith(prefix)) {
      base = target.endsWith('.ts') ? target : target + spec.slice(prefix.length);
      break;
    }
  if (!base && spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  if (!base) return null; // npm package
  // TS 源码里的 `./x.js` 指向 `./x.ts`。
  const stripped = base.replace(/\.(js|jsx|mjs)$/, '');
  for (const candidate of [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    path.join(stripped, 'index.ts'),
    path.join(stripped, 'index.tsx'),
  ])
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return path.resolve(candidate);
  return null; // css / json / assets
}

/**
 * 收集运行时依赖：先按 TS 语义编译（esbuild，与 Vite 构建一致），type-only 导入、全是
 * `type` 的具名导入和类型别名都已擦除；再从规整后的 JS 里取 import / export-from / 动态 import()。
 */
async function runtimeImports(file: string, source: string): Promise<string[]> {
  const { code } = await transformWithEsbuild(source, file, {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
    jsx: 'automatic',
    format: 'esm',
    target: 'esnext',
    sourcemap: false,
  });
  const specs: string[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/g))
    specs.push(m[1]);
  for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g)) specs.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

async function reachable(entry: string): Promise<Map<string, string>> {
  const parent = new Map<string, string>([[entry, '']]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const spec of await runtimeImports(file, readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(file, spec);
      if (target && !parent.has(target)) {
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return parent;
}

function chain(graph: Map<string, string>, file: string): string {
  const parts: string[] = [];
  for (let current = file; current; current = graph.get(current) ?? '')
    parts.unshift(path.relative(renderer, current));
  return parts.join(' -> ');
}

describe('design window import boundary', () => {
  it('the design window entry never loads persisted main-window stores', async () => {
    const graph = await reachable(path.join(renderer, 'design-window.tsx'));
    // Sanity: the walk really reaches the shared canvas mount, runtime and upstream plugin.
    expect(graph.has(path.join(renderer, 'features/design/mounts/CanvasMount.tsx'))).toBe(true);
    expect(graph.has(path.join(renderer, 'features/design/runtime.ts'))).toBe(true);
    expect(graph.has(path.join(renderer, 'features/design/vetta/src/index.tsx'))).toBe(true);
    const leaks = FORBIDDEN.map((rel) => path.join(renderer, rel))
      .filter((file) => graph.has(file))
      .map((file) => chain(graph, file));
    expect(leaks).toEqual([]);
  });

  it('the walker does detect a forbidden store when it is reachable', async () => {
    const graph = await reachable(path.join(renderer, 'features/design/DesignRuntimeHost.tsx'));
    expect(graph.has(path.join(renderer, 'stores/sessions/index.ts'))).toBe(true);
  });

  it('treats type-only imports as erased but keeps value imports after a type alias', async () => {
    const specs = await runtimeImports(
      'x.ts',
      [
        "import type { A } from './erased-a';",
        "import { type B } from './erased-b';",
        'export type Foo = { a: string };',
        "export { value } from './kept-export';",
        "import { type C, d } from './kept-mixed';",
        'export const used = d;',
        "import './kept-side-effect';",
        "const lazy = () => import('./kept-dynamic');",
      ].join('\n')
    );
    expect(specs.sort()).toEqual([
      './kept-dynamic',
      './kept-export',
      './kept-mixed',
      './kept-side-effect',
    ]);
  });
});
