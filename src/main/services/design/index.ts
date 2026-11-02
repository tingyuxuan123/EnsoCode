import { webContents } from 'electron';
import { getWindowWebContents } from '../../windows/createAppWindow';
import { getMainWindow } from '../../windows/MainWindow';
import { DesignToolBroker } from './toolBroker';

let broker: DesignToolBroker | null = null;

/** worker vetd_* 调用 → Renderer 设计运行时的唯一调度器（设计稿 D1）。 */
export function getDesignToolBroker(): DesignToolBroker {
  broker ??= new DesignToolBroker({
    find: (id) => {
      const contents = webContents.fromId(id);
      return contents
        ? {
            id,
            send: (channel, payload) => contents.send(channel, payload),
            isDestroyed: () => contents.isDestroyed(),
          }
        : null;
    },
    fallbackId: () => {
      const main = getMainWindow();
      return main && !main.isDestroyed() ? getWindowWebContents(main).id : null;
    },
  });
  return broker;
}

export { getDesignPaths } from './appPaths';

export { DesignToolBroker, DesignToolError } from './toolBroker';
