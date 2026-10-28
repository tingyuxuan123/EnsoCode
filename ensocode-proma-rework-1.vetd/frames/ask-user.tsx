export const frame = { width: 1440, height: 900, title: "运行控制 · Agent 提问" };

import { AskBar, RetryBar } from '../components/RunBars';
import WorkbenchScreen from './index';

/** Agent 经 ask_user 提问：选项一键答 / 自由输入 / 提交中 / 第二条已超时；上方叠一条自动重试条 */
export default function AskUserScreen() {
  return (
    <WorkbenchScreen
      bars={
        <>
          <RetryBar />
          <AskBar />
        </>
      }
    />
  );
}
