export const frame = {
  width: 1440,
  height: 1180,
  title: 'A+D 合并 · 完成态（含失败、长输出、悬停）',
};

import { ChatColumn, ReplyHead, Shell, UserTurn } from '../components/Shell';

/** 阶段内的单行：工具图标 + 等宽命令 + 右对齐耗时 */
function Step({
  icon,
  text,
  time,
  running,
  hovered,
}: {
  icon: string;
  text: string;
  time?: string;
  running?: boolean;
  hovered?: boolean;
}) {
  return (
    <div
      className={`flex h-[26px] items-center gap-2 rounded-md px-1.5 ${hovered ? 'bg-accent' : ''}`}
    >
      <span
        className={`${icon} size-3.5 shrink-0 ${running ? 'text-brand' : 'text-muted-foreground'}`}
      />
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${
          running ? 'text-foreground' : 'text-foreground/75'
        }`}
      >
        {text}
      </span>
      {hovered ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="flex size-5 items-center justify-center rounded text-muted-foreground">
            <span className="icon-[lucide--copy] size-3" />
          </span>
          <span className="flex size-5 items-center justify-center rounded text-muted-foreground">
            <span className="icon-[lucide--external-link] size-3" />
          </span>
        </div>
      ) : (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{time}</span>
      )}
    </div>
  );
}

/** 思考行：夹在步骤之间，比工具行更轻，不占图标列 */
function Think({ text }: { text: string }) {
  return (
    <div className="flex h-6 items-center gap-2 px-1.5 text-[11px] text-muted-foreground/80">
      <span className="icon-[lucide--brain] size-3 shrink-0 text-muted-foreground/60" />
      <span>{text}</span>
    </div>
  );
}

function PhaseRow({
  name,
  thinking,
  calls,
  open,
  state = 'done',
  note,
}: {
  name: string;
  thinking: string;
  calls: number;
  open?: boolean;
  state?: 'done' | 'failed' | 'running';
  note?: string;
}) {
  const dot =
    state === 'failed' ? 'bg-destructive' : state === 'running' ? 'bg-brand' : 'bg-foreground/25';
  return (
    <div className="flex h-7 items-center gap-1.5 px-1">
      <span
        className={`icon-[lucide--chevron-right] size-3 shrink-0 text-muted-foreground ${open ? 'rotate-90' : ''}`}
      />
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      <span
        className={`truncate text-[12px] ${open ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
      >
        {name}
      </span>
      {note ? (
        <span className="ml-1 shrink-0 rounded bg-destructive/10 px-1.5 py-px text-[10px] text-destructive">
          {note}
        </span>
      ) : null}
      <span className="shrink-0 text-[11px] text-muted-foreground/80">
        思考 {thinking} · {calls} 次调用
      </span>
    </div>
  );
}

export default function Combined() {
  return (
    <Shell label="A+D 合并 · 完成态">
      <ChatColumn>
        <UserTurn text="梳理一下这个项目的结构：入口、模块划分与关键依赖" />
        <div className="flex flex-col gap-3">
          <ReplyHead />
          <div className="flex flex-col gap-0.5">
            {/* 摘要行：整块唯一的强信息 */}
            <div className="flex h-7 items-center gap-1.5 px-1 text-[12px]">
              <span className="size-1.5 shrink-0 rounded-full bg-warning" />
              <span className="font-medium text-foreground">已工作 20.9s</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">3 个阶段</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">22 次调用</span>
              <span className="rounded bg-destructive/10 px-1.5 py-px text-[10px] text-destructive">
                1 次失败
              </span>
            </div>

            {/* 阶段 1：展开。思考与步骤同一条流，长输出按摘要收口 */}
            <PhaseRow name="探查骨架" thinking="4.2s" calls={11} open />
            <div className="flex flex-col pb-1 pl-[22px] pr-1">
              <Step icon="icon-[lucide--square-terminal]" text="ls ." time="0s" />
              <Step icon="icon-[lucide--file-text]" text="package.json" time="0s" />
              <Think text="先看根目录，再确认 monorepo 划分" />
              <Step
                icon="icon-[lucide--square-terminal]"
                text='echo "=== src ===" && ls src'
                time="0.3s"
              />
              <Step
                icon="icon-[lucide--square-terminal]"
                text="find src -maxdepth 2 -type d | sort"
                time="0.3s"
              />
              <Step icon="icon-[lucide--file-text]" text="src/main/index.ts" time="0s" hovered />
              {/* 长输出：默认只给摘要 + 头部预览 */}
              <div className="my-1 ml-1.5 overflow-hidden rounded-lg bg-muted">
                <div className="flex h-6 items-center gap-2 px-2.5">
                  <span className="icon-[lucide--square-terminal] size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/70">
                    ls src/agent | grep -v test | head -80
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                    0.1s
                  </span>
                </div>
                <pre className="m-0 border-t border-border/60 px-2.5 py-1.5 font-mono text-[11px] leading-[19px] text-muted-foreground">
                  {`adaptive.ts       agentHost.ts      compaction.ts
commandQueue.ts   goalState.ts      mcpTools.ts
messageStore.ts   sessionRunner.ts  supervisor.ts`}
                </pre>
                <div className="flex h-7 items-center gap-1 border-t border-border/60 px-2.5 text-[11px] text-muted-foreground">
                  <span className="icon-[lucide--chevron-down] size-3" />共 42 个文件 · 展开全部
                </div>
              </div>
              <Step
                icon="icon-[lucide--square-terminal]"
                text="ls docs docs/engineering-reference"
                time="0.1s"
              />
              <div className="flex h-6 items-center px-1.5 text-[11px] text-muted-foreground">
                <button type="button" className="flex items-center gap-1 hover:text-foreground">
                  <span className="icon-[lucide--chevron-down] size-3" />
                  还有 3 次调用
                </button>
              </div>
            </div>

            {/* 阶段 2：折叠成一行，扫一眼就知道干了什么 */}
            <PhaseRow name="读取入口与 IPC" thinking="2.9s" calls={6} />

            {/* 阶段 3：失败就地展开，给原因与下一步 */}
            <PhaseRow
              name="核对依赖边界"
              thinking="1.6s"
              calls={5}
              open
              state="failed"
              note="1 次失败"
            />
            <div className="flex flex-col gap-1.5 pb-1 pl-[22px] pr-1">
              <Step icon="icon-[lucide--file-text]" text="electron.vite.config.ts" time="0s" />
              <div className="ml-1.5 rounded-lg bg-destructive-soft">
                <div className="flex h-6 items-center gap-2 px-2.5">
                  <span className="icon-[lucide--circle-alert] size-3 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-destructive">
                    git ls-files packages | head -40
                  </span>
                  <span className="shrink-0 rounded bg-destructive/12 px-1.5 py-px text-[10px] text-destructive">
                    退出码 128
                  </span>
                </div>
                <pre className="m-0 border-t border-destructive/15 px-2.5 py-1.5 font-mono text-[11px] leading-[19px] text-destructive/90">
                  fatal: not a git repository (or any of the parent directories): .git
                </pre>
              </div>
              <div className="flex items-center gap-1 pl-1">
                <span className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium">
                  <span className="icon-[lucide--rotate-cw] size-3" />
                  重试这一步
                </span>
                <span className="rounded-md px-2 py-1 text-[11px] text-muted-foreground">
                  跳过并继续
                </span>
              </div>
              <Step icon="icon-[lucide--file-text]" text="pnpm-workspace.yaml" time="0s" />
            </div>
          </div>

          <p className="text-[13px] leading-6">
            项目分三层：<span className="font-mono text-[12px]">src/main</span> 负责窗口与 IPC，
            <span className="font-mono text-[12px]">src/agent</span> 是会话与工具执行，
            <span className="font-mono text-[12px]">src/renderer</span> 只有 UI。跨层调用全部经由
            preload 的类型化出口。
            <br />
            <span className="text-muted-foreground">
              第三阶段有一次 <span className="font-mono text-[12px]">git ls-files</span> 失败，
              因为工作副本里没有 <span className="font-mono text-[12px]">.git</span>；依赖边界我改从
              <span className="font-mono text-[12px]">pnpm-workspace.yaml</span> 推断。
            </span>
          </p>
        </div>
      </ChatColumn>
    </Shell>
  );
}
