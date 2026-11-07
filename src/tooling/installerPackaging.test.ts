import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

const yml = readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8');
const lock = readFileSync(path.resolve(__dirname, '../../pnpm-lock.yaml'), 'utf8');

/** Vite 已打进 out/renderer，安装包不得再带一份 production node_modules。 */
const RENDERER_ONLY_PACKAGES = [
  '@base-ui/react',
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@pierre/diffs',
  '@shikijs/themes',
  '@xterm/addon-fit',
  '@xterm/addon-search',
  '@xterm/addon-serialize',
  '@xterm/addon-unicode11',
  '@xterm/addon-web-links',
  '@xterm/xterm',
  'class-variance-authority',
  'clsx',
  'cytoscape',
  'cytoscape-fcose',
  'dockview-react',
  'framer-motion',
  'hast-util-sanitize',
  'lucide-react',
  'mermaid',
  'prettier',
  'qrcode',
  'react',
  'react-dom',
  'react-markdown',
  'react-virtuoso',
  'rehype-raw',
  'rehype-sanitize',
  'remark-gfm',
  'shiki',
  'tailwind-merge',
  'unist-util-visit',
  'zustand',
] as const;

const MAIN_RUNTIME_PACKAGES = [
  '@bufbuild/protobuf',
  '@earendil-works/pi-coding-agent',
  '@electron-toolkit/utils',
  '@huggingface/tokenizers',
  '@modelcontextprotocol/sdk',
  '@rahularya01/pi-cursor',
  'better-sqlite3',
  'electron-updater',
  'koffi',
  'level',
  'node-datachannel',
  'node-pty',
  'quickjs-wasi',
  'smol-toml',
  'sqlite-vec',
  'tweetnacl',
  'typebox',
  'undici',
  'web-push',
  'yaml',
] as const;

function listed(block: object | undefined, name: string): string | undefined {
  if (!block || !Object.hasOwn(block, name)) return undefined;
  return (block as Record<string, string>)[name];
}

describe('installer packaging', () => {
  it('keeps renderer-only libraries out of production dependencies', () => {
    for (const name of RENDERER_ONLY_PACKAGES) {
      expect(
        listed(pkg.dependencies, name),
        `${name} must not be a production dependency`
      ).toBeUndefined();
      expect(listed(pkg.devDependencies, name), `${name} stays installable for Vite`).toEqual(
        expect.any(String)
      );
    }
  });

  it('keeps main-process runtime packages as production dependencies', () => {
    for (const name of MAIN_RUNTIME_PACKAGES) {
      expect(
        listed(pkg.dependencies, name) ?? listed(pkg.optionalDependencies, name),
        `${name} must remain a packaged runtime dependency`
      ).toEqual(expect.any(String));
    }
  });

  it('strips maps, typings, docs, llama compile payload and unused Chromium locales', () => {
    expect(yml).toContain("'!**/*.map'");
    expect(yml).toContain('!**/node_modules/**/*.{d.ts,d.mts,d.cts}');
    expect(yml).toContain('!node_modules/node-llama-cpp/llama/gitRelease.bundle');
    expect(yml).toContain('!node_modules/esbuild/**');
    expect(yml).toContain('!node_modules/@esbuild/**');
    expect(yml).toContain('!node_modules/better-sqlite3/deps/**');
    expect(yml).toMatch(/^electronLanguages:/m);
    expect(yml).toContain('en-US');
    expect(yml).toContain('zh-CN');
    expect(yml).toContain('zh_CN');
  });

  it('does not attach ignore-only files to mac/win/linux', () => {
    expect(yml).toContain('!node_modules/better-sqlite3/prebuilds/linuxmusl*');
    for (const platform of ['mac', 'win', 'linux']) {
      const block = yml.split(new RegExp(`^${platform}:`, 'm'))[1]?.split(/^[a-z]/m)[0] ?? '';
      expect(block, platform).not.toMatch(/^\s+files:/m);
    }
  });

  it('drops the unused pi TUI clipboard native and strips foreign sqlite prebuilds after pack', () => {
    expect(yml).toContain('!node_modules/@mariozechner/clipboard');
    expect(yml).toContain('src/tooling/stripPackagedNatives.mjs');
  });

  it('mac dir/local builds keep hardened runtime entitlements for native modules', () => {
    expect(yml).toContain('build/entitlements.mac.plist');
    expect(yml).toContain('hardenedRuntime: true');
  });

  it('declares Apple Events usage for osascript window activation', () => {
    const plist = readFileSync(
      path.resolve(__dirname, '../../build/entitlements.mac.plist'),
      'utf8'
    );
    expect(plist).toMatch(/<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\/>/);
    expect(yml).toMatch(/^ {4}NSAppleEventsUsageDescription: \S/m);
  });

  it('pins pnpm store paths to versions present in the lockfile', () => {
    const pinned = [...yml.matchAll(/from: node_modules\/\.pnpm\/([^/@\s]+)@([^/\s]+)\//g)];
    expect(pinned.map((m) => m[1])).toEqual(expect.arrayContaining(['koffi', 'node-datachannel']));
    for (const [, name, version] of pinned) {
      expect(lock, `${name}@${version} must match pnpm-lock.yaml`).toMatch(
        new RegExp(`^  ${name}@${version.replace(/\./g, '\\.')}:`, 'm')
      );
    }
  });

  it('copies the koffi platform binding sibling and unpacks its .node', () => {
    expect(yml).toMatch(
      /- from: node_modules\/\.pnpm\/koffi@[^/\s]+\/node_modules\/@koromix\r?\n\s+to: node_modules\/@koromix\r?\n/
    );
    const unpack = yml.split(/^asarUnpack:/m)[1]?.split(/^[a-z]/m)[0] ?? '';
    expect(unpack).toContain('- node_modules/@koromix/**/*.node');
    expect(unpack).not.toContain('node_modules/koffi/**/*.node');
    expect(yml).toContain("'!node_modules/koffi/{vendor,lib,doc}/**'");
  });
});
