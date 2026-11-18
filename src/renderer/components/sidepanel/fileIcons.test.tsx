import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileTypeIcon, fileIconId, fileIconUrl } from './fileIcons';

const ASSET_DIR = path.resolve(import.meta.dirname, '../../assets/file-icons');
const manifest = JSON.parse(readFileSync(path.join(ASSET_DIR, 'manifest.json'), 'utf8')) as {
  file: string;
  folder: string;
  rootFolder: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
};

describe('文件按 Material Icon Theme 的映射取图标', () => {
  it('整名匹配优先于扩展名', () => {
    expect(fileIconId('package.json')).toBe('nodejs');
    expect(fileIconId('pnpm-lock.yaml')).toBe('pnpm');
  });

  it('整名匹配不区分大小写，取路径的最后一段', () => {
    expect(fileIconId('Dockerfile')).toBe('docker');
    expect(fileIconId('src/renderer/App.vue')).toBe('vue');
    expect(fileIconId('src\\renderer\\App.vue')).toBe('vue');
  });

  it('复合扩展名从最长开始试', () => {
    expect(fileIconId('a.test.ts')).toBe('test-ts');
    expect(fileIconId('a.test.tsx')).toBe('test-jsx');
    expect(fileIconId('a.d.ts')).toBe('typescript-def');
    expect(fileIconId('a.vue')).toBe('vue');
  });

  it('名字开头的点是隐藏文件前缀，不算扩展名', () => {
    expect(fileIconId('.ts')).toBe('file');
  });

  it('只认路径形式的映射键的结尾', () => {
    expect(fileIconId('.config/graphqlrc')).toBe('graphql');
    expect(fileIconId('packages/app/.config/graphqlrc')).toBe('graphql');
    expect(fileIconId('other/config/graphqlrc')).toBe('file');
  });

  it('没匹配到的类型回落到通用文件图标', () => {
    expect(fileIconId('notes.zzz')).toBe('file');
    expect(fileIconId('LICENSE')).toBe('license');
  });
});

describe('目录按名字和展开状态取图标', () => {
  it('同名目录展开前后是不同图标', () => {
    expect(fileIconId('node_modules', true)).toBe('folder-node');
    expect(fileIconId('node_modules', true, true)).toBe('folder-node-open');
    expect(fileIconId('src', true)).toBe('folder-src');
  });

  it('没匹配到的目录和项目根目录用通用图标', () => {
    expect(fileIconId('whatever', true)).toBe('folder');
    expect(fileIconId('whatever', true, true)).toBe('folder-open');
    expect(fileIconId('whatever', true, false, true)).toBe('folder-root');
    expect(fileIconId('whatever', true, true, true)).toBe('folder-root-open');
  });
});

describe('随包的图标与映射一致', () => {
  it('映射引用到的图标都有 SVG', () => {
    const used = new Set([
      manifest.file,
      manifest.folder,
      manifest.rootFolder,
      `${manifest.folder}-open`,
      `${manifest.rootFolder}-open`,
      ...Object.values(manifest.fileNames),
      ...Object.values(manifest.fileExtensions),
      ...Object.values(manifest.folderNames).flatMap((id) => [id, `${id}-open`]),
    ]);
    const bundled = new Set(readdirSync(path.join(ASSET_DIR, 'icons')));
    expect([...used].filter((id) => !bundled.has(`${id}.svg`))).toEqual([]);
  });

  it('每个图标的 URL 都能解析出来', () => {
    // dev server 的 URL 带 `?no-inline`，构建产物不带：只认文件名。
    expect(fileIconUrl('a.vue')).toMatch(/vue\.svg(\?.*)?$/);
    expect(fileIconUrl('a.zzz')).toMatch(/file\.svg(\?.*)?$/);
  });
});

describe('FileTypeIcon', () => {
  it('普通文件和目录渲染主题图标', () => {
    expect(renderToStaticMarkup(<FileTypeIcon name="a.vue" />)).toMatch(/<img[^>]+vue\.svg/);
    expect(renderToStaticMarkup(<FileTypeIcon name="src" isDir />)).toMatch(
      /<img[^>]+folder-src\.svg/
    );
  });

  it('图标是装饰性的，不参与无障碍树', () => {
    const html = renderToStaticMarkup(<FileTypeIcon name="a.vue" />);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it('设计目录和新旧分享文件用宿主原生图标，不依赖上游 data URL', () => {
    const dir = renderToStaticMarkup(<FileTypeIcon name="app.vetd" isDir />);
    const packed = renderToStaticMarkup(<FileTypeIcon name="share.VETDZ" />);
    for (const html of [dir, packed]) {
      expect(html).not.toContain('<img');
      expect(html).toContain('text-primary');
    }
  });
});
