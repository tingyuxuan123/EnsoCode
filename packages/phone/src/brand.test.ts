import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * PWA 壳层文案不在 React 里：页面标题、安装清单里的应用名、推送兜底通知标题
 * 都直接写在静态文件里，用这道文件级断言守住对外品牌。
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('手机端对外品牌', () => {
  it('页面标题与 iOS 主屏幕图标名是「CodeKiln」', () => {
    const html = read('../index.html');
    expect(html).toContain('<title>CodeKiln</title>');
    expect(html).toContain('name="apple-mobile-web-app-title" content="CodeKiln"');
  });

  it('安装清单的名称与描述是「CodeKiln」', () => {
    const manifest = JSON.parse(read('../public/manifest.webmanifest')) as {
      name: string;
      short_name: string;
      description: string;
    };
    expect(manifest.name).toBe('CodeKiln');
    expect(manifest.short_name).toBe('CodeKiln');
    expect(manifest.description).toContain('CodeKiln');
  });

  it('推送兜底通知标题是「CodeKiln」，冷启动缓存 key 保持旧标识不变', () => {
    const sw = read('../public/sw.js');
    expect(sw).toContain("title: 'CodeKiln'");
    // 缓存 key 属于兼容标识：换了会让已装 PWA 的冷启动跳转失效
    expect(sw).toContain("const LAUNCH_SESSION_CACHE = 'enso-phone-launch'");
  });
});
