export const frame = { width: 1440, height: 900, title: 'A+D 合并 · 运行中（深色）' };

import { ChatColumn, ReplyHead, Shell, UserTurn } from '../components/Shell';

function Step({
  icon,
  text,
  time,
  state = 'done',
}: {
  icon: string;
  text: string;
  time?: string;
  state?: 'done' | 'running';
}) {
  const running = state === 'running';
  return (
    <div
      className={`flex h-[26px] items-center gap-2 rounded-md px-1.5 ${
        running ? 'bg-brand/12' : ''
      }`}
    >
      {running ? (
        <span className="icon-[lucide--loader-circle] size-3.5 shrink-0 animate-spin text-brand" />
      ) : (
        <span className={`${icon} size-3.5 shrink-0 text-muted-foreground`} />
      )}
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${
          running ? 'text-foreground' : 'text-foreground/70'
        }`}
      >
        {text}
      </span>
      <span
        className={`shrink-0 text-[10px] tabular-nums ${
          running ? 'text-brand' : 'text-muted-foreground/70'
        }`}
      >
        {time}
      </span>
    </div>
  );
}

function Think({ text }: { text: string }) {
  return (
    <div className="flex h-6 items-center gap-2 px-1.5 text-[11px] text-muted-foreground/75">
      <span className="icon-[lucide--brain] size-3 shrink-0 text-muted-foreground/55" />
      <span>{text}</span>
    </div>
  );
}

export default function CombinedRunning() {
  return (
    <Shell label="A+D 合并 · 运行中" dark>
      <ChatColumn>
        <UserTurn text="梳理一下这个项目的结构：入口、模块划分与关键依赖" />
        <div className="flex flex-col gap-3">
          <ReplyHead />
          <div className="flex flex-col gap-0.5">
            <div className="flex h-7 items-center gap-1.5 px-1 text-[12px]">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
              <span className="font-medium text-foreground">已工作 12.4s</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">正在探查骨架</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">9 次调用</span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="icon-[lucide--square] size-2.5" />
                停止
              </span>
            </div>

            <div className="flex h-7 items-center gap-1.5 px-1">
              <span className="icon-[lucide--chevron-right] size-3 shrink-0 rotate-90 text-muted-foreground" />
              <span className="size-1.5 shrink-0 rounded-full bg-brand" />
              <span className="truncate text-[12px] font-medium">探查骨架</span>
              <span className="shrink-0 text-[11px] text-muted-foreground/80">
                思考 2.1s · 4 次调用
              </span>
            </div>
            <div className="flex flex-col pb-1 pl-[22px] pr-1">
              <Step icon="icon-[lucide--square-terminal]" text="ls ." time="0s" />
              <Step icon="icon-[lucide--file-text]" text="package.json" time="0s" />
              <Think text="拿到了脚本与依赖，接下来看目录层级" />
              <Step
                icon="icon-[lucide--square-terminal]"
                text="find src -maxdepth 2 -type d | sort"
                time="0.4s"
                state="running"
              />
            </div>
          </div>

          <p className="text-[13px] leading-6 text-muted-foreground">
            正在梳理目录层级 —— 已完成根目录与包清单的读取，正在展开 src 的两级子目录。
          </p>
        </div>
      </ChatColumn>
    </Shell>
  );
}
