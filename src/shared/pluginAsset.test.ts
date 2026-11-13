import { describe, expect, it } from 'vitest';
import { localImageUrlToPath, parsePluginAssetUrl, pluginAssetUrl } from './localImage';

describe('插件资源标识 URL', () => {
  it('只编码插件标识和包内路径，不能退回任意本机路径', () => {
    const url = new URL(pluginAssetUrl('local.demo', 'images/中文 图.png', 'build/2'));
    expect(parsePluginAssetUrl(url)).toEqual({ pluginId: 'local.demo', rel: 'images/中文 图.png' });
    expect(localImageUrlToPath(url)).toBeNull();
  });
  it.each([
    'local-image://plugin-asset/a.b/%2e%2e%2fsecret.png',
    'local-image://plugin-asset/a.b/images%2fsecret.png',
    'local-image://plugin-asset/a.b/%00.png',
    'local-image://plugin-asset/bad/secret.png',
    'local-image://plugin-asset/a.b',
    'local-image://plugin-asset/a.b/x\\y.png',
  ])('拒绝越界或坏标识 %s', (value) => expect(parsePluginAssetUrl(new URL(value))).toBeNull());
});
