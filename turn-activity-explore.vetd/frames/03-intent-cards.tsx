export const frame = { width: 1440, height: 900, title: '方案 C · 意图卡片' };

import { ChatColumn, ReplyHead, Shell, UserTurn } from '../components/Shell';

const STEPS = [
  { icon: 'icon-[lucide--square-terminal]', text: 'ls .', time: '0s' },
  { icon: 'icon-[lucide--file-text]', text: 'package.json', time: '0s' },
  {
    icon: 'icon-[lucide--square-terminal]',
    text: 'find src -maxdepth 2 -type d | sort',
    time: '0.3s',
  },
  {
    icon: 'icon-[lucide--square-terminal]',
    text: 'ls src/main src/agent src/renderer/components',
    time: '0.1s',
  },
  { icon: 'icon-[lucide--file-text]', text: 'src/main/index.ts', time: '0s' },
];

export default function IntentCards() {
  return (
    <Shell label="方案 C · 意图卡片">
      <ChatColumn>
        <UserTurn text="梳理一下这个项目的结构：入口、模块划分与关键依赖" />
        <div className="flex flex-col gap-3">
          <ReplyHead />
          <div className="flex flex-col gap-2">
            <div className="rounded-xl bg-secondary/70">
              <div className="flex h-9 items-center gap-2 px-3">
                <span className="icon-[lucide--chevron-down] size-3 text-muted-foreground" />
                <span className="icon-[lucide--compass] size-3.5 text-brand" />
                <span className="text-[13px] font-medium">摸清项目有哪些模块</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  11 次 · 4.2s
                </span>
              </div>
              <div className="flex flex-col gap-px pb-2 pl-[38px] pr-3">
                {STEPS.map((step) => (
                  <div key={step.text} className="flex h-[26px] items-center gap-2">
                    <span className={`${step.icon} size-3.5 shrink-0 text-muted-foreground`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75">
                      {step.text}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                      {step.time}
                    </span>
                  </div>
                ))}
                <div className="flex h-6 items-center gap-1 text-[11px] text-muted-foreground">
                  还有 6 次
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-secondary/70">
              <div className="flex h-9 items-center gap-2 px-3">
                <span className="icon-[lucide--chevron-right] size-3 text-muted-foreground" />
                <span className="icon-[lucide--plug] size-3.5 text-muted-foreground" />
                <span className="text-[13px]">对齐主进程与渲染层的接口</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  6 次 · 2.9s
                </span>
              </div>
              <div className="truncate px-3 pb-2.5 pl-[38px] font-mono text-[11px] text-muted-foreground">
                src/main/index.ts · cat src/main/ipc/index.ts · src/preload/index.ts
              </div>
            </div>
            <div className="rounded-xl bg-secondary/70">
              <div className="flex h-9 items-center gap-2 px-3">
                <span className="icon-[lucide--chevron-right] size-3 text-muted-foreground" />
                <span className="icon-[lucide--boxes] size-3.5 text-muted-foreground" />
                <span className="text-[13px]">确认各包的依赖边界</span>
                <span className="mr-2 rounded bg-warning/12 px-1.5 py-px text-[10px] text-warning">
                  1 次被拒
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  5 次 · 1.6s
                </span>
              </div>
              <div className="truncate px-3 pb-2.5 pl-[38px] font-mono text-[11px] text-muted-foreground">
                electron.vite.config.ts · git ls-files packages · pnpm-workspace.yaml
              </div>
            </div>
          </div>
          <p className="text-[13px] leading-6">
            项目分三层：<span className="font-mono text-[12px]">src/main</span> 负责窗口与 IPC，
            <span className="font-mono text-[12px]">src/agent</span> 是会话与工具执行，
            <span className="font-mono text-[12px]">src/renderer</span> 只有 UI。跨层调用全部经由
            preload 的类型化出口。
          </p>
        </div>
      </ChatColumn>
    </Shell>
  );
}
