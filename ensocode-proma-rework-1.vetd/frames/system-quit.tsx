export const frame = { width: 1440, height: 900, title: "系统 · 退出确认" };

import { QuitDialog } from '../components/system/Onboarding';
import { Overlay } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 关闭窗口时：取消 / 最小化到托盘（手机仍可连）/ 退出（手机断开） */
export default function SystemQuit() {
  return (
    <>
      <WorkbenchScreen running={false} />
      <Overlay>
        <QuitDialog onClose={() => undefined} />
      </Overlay>
    </>
  );
}
