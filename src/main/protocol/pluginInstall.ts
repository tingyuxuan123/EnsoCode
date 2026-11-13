import {
  pluginInstallUrlFromLink,
  pluginInstallUrlsFromArgv,
} from '@shared/extensionPlugins/pluginProtocol';
/** 只排队外部安装意图；交给已有设置页下载预览，绝不提交或启用。 */
export function createPluginInstallInbox(platform: NodeJS.Platform) {
  const queued: string[] = [];
  let deliver: ((url: string) => void) | null = null;
  const push = (url: string | null) => {
    if (!url || queued.includes(url)) return;
    if (deliver) deliver(url);
    else if (queued.length < 10) queued.push(url);
  };
  return {
    noteLink(raw: string) {
      push(pluginInstallUrlFromLink(raw));
    },
    noteArgv(argv: readonly string[]) {
      if (platform !== 'darwin') for (const url of pluginInstallUrlsFromArgv(argv)) push(url);
    },
    start(send: (url: string) => void) {
      deliver = send;
      for (const url of queued.splice(0)) send(url);
    },
  };
}
