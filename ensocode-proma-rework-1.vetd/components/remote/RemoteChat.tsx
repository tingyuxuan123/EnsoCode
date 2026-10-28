import { useState } from 'react';
import { Link } from 'react-router';
import { Composer } from '../Composer';
import { AssistantHeader, CoworkerTabs, UserMessage, WorkedRow } from '../Conversation';

/** 远程会话主体（nodes/RemoteNodeChat.tsx）：与本地会话同一套时间线，但会话跑在对方电脑上 */
export function RemoteChat({ offline = false }: { offline?: boolean }) {
  const [tab, setTab] = useState('main');
  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <CoworkerTabs active={tab} onSelect={setTab} />
      {offline && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-warning-soft px-4 text-[11px]">
          <span className="icon-[lucide--wifi-off] size-3.5 text-warning" />
          对方桌面离线 —— 可以查看历史，发送与审批会在重连后排队
          <Link to="/remote-node" className="ml-auto text-primary">重试连接</Link>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        <div className="mx-auto w-full max-w-[720px]">
          <UserMessage time="10:02">把发布前的检查清单跑一遍，重点看原生模块。</UserMessage>
          <AssistantHeader time="10:03" name="工作室 Mac mini" />
          <WorkedRow />
          <p className="text-[15px] leading-[27px]">检查完成：打包产物里的 koffi 与 node-pty 都随架构正确落位，签名一致；Windows 侧命令壳没有回归。</p>
          <p className="mt-2 text-[12px] text-muted">结果来自对方电脑上的会话，本机不保存工具输出。</p>
        </div>
      </div>
      <div className="shrink-0 pb-3">
        <div className="mx-auto w-full max-w-[720px] px-6">
          <Composer running={false} locked={offline} onSend={() => undefined} />
        </div>
      </div>
    </div>
  );
}
