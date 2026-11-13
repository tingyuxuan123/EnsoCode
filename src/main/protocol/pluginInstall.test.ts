import { describe, expect, it } from 'vitest';
import { pluginInstallUrlFromLink } from '../../shared/extensionPlugins/pluginProtocol';
import { createPluginInstallInbox } from './pluginInstall';

describe('网页插件安装只打开确认预览', () => {
  it('只接收 HTTPS 插件地址，拒绝变形入口和私有协议', () => {
    const good = 'https://example.com/plugin.zip';
    expect(pluginInstallUrlFromLink(`enso://install-plugin?url=${encodeURIComponent(good)}`)).toBe(
      good
    );
    for (const value of [
      'file:///etc/passwd',
      'http://example.com/plugin.zip',
      'https://user:pass@example.com/x',
    ])
      expect(
        pluginInstallUrlFromLink(`enso://install-plugin?url=${encodeURIComponent(value)}`)
      ).toBeNull();
    expect(
      pluginInstallUrlFromLink(`enso://install-plugin/other?url=${encodeURIComponent(good)}`)
    ).toBeNull();
  });
  it('ready 之前队列去重，Windows argv 与 macOS open-url 分别传递', () => {
    const inbox = createPluginInstallInbox('win32');
    const link = 'enso://install-plugin?url=https%3A%2F%2Fexample.com%2Fplugin.zip';
    inbox.noteArgv(['app', link, link]);
    const delivered: string[] = [];
    inbox.start((url) => delivered.push(url));
    expect(delivered).toEqual(['https://example.com/plugin.zip']);
    const mac = createPluginInstallInbox('darwin');
    mac.noteArgv([link]);
    mac.start((url) => delivered.push(url));
    expect(delivered).toHaveLength(1);
    mac.noteLink(link);
    expect(delivered).toHaveLength(2);
  });
});
