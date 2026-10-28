export const frame = { width: 1440, height: 900, title: "节点 · 连接到节点" };

import { useEffect } from 'react';
import { Dialog, Field } from '../components/Controls';
import { Overlay } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 连接到节点：对方桌面「设置 → 设备」生成配对码并复制链接，粘到这里；连接中 / 链接失效 */
export default function NodePairFrame() {
  return (
    <>
      <WorkbenchScreen running={false} />
      <Overlay>
        <Dialog
          title="连接到节点"
          description="在对方电脑打开「设置 → 设备」，生成配对码并复制链接，粘到这里。"
          width={480}
          onClose={() => undefined}
          footer={
            <>
              <button className="px-3 py-2 text-[12px] text-muted">取消</button>
              <button className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">连接</button>
            </>
          }
        >
          <Field label="配对链接" hint="链接 60 秒内有效且只能使用一次；连接后对方桌面会显示这台设备。">
            <input defaultValue="enso://pair?code=8F2K-QP7M" className="h-9 w-full rounded-control border border-border bg-input px-3 font-mono text-[12px] outline-none" />
          </Field>
          <p className="text-[11px] leading-5 text-muted">连接后浏览并操控对方的会话；agent、密钥与历史都留在对方机器上。</p>
        </Dialog>
      </Overlay>
    </>
  );
}
