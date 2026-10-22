export const frame = { width: 1440, height: 900, title: '状态与密度（深色）' };

import { ChatColumn, ReplyHead, Shell } from '../components/Shell';

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="size-1 rounded-full bg-brand" />
      {children}
    </div>
  );
}

export default function States() {
  return (
    <Shell label="状态与密度 · 深色" dark>
      <ChatColumn>
        <div className="flex flex-col gap-4">
          <ReplyHead />
          <div className="flex flex-col gap-2">
            <SectionLabel>运行中：当前一步高亮，其余保持安静</SectionLabel>
            <div className="flex flex-col gap-1">
              <div className="flex h-7 items-center gap-2 text-[12px]">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                <span className="text-foreground">已工作 12.4s</span>
                <span className="text-border">·</span>
                <span className="text-muted-foreground">正在探查骨架</span>
              </div>
              <div className="flex h-7 items-center gap-1.5 pl-4 text-[12px]">
                <span className="icon-[lucide--chevron-down] size-3 rotate-90 text-muted-foreground" />
                <span className="font-medium">探查骨架</span>
                <span className="text-muted-foreground">思考 2.1s</span>
                <span className="text-border">·</span>
                <span className="text-muted-foreground">4 次调用</span>
              </div>
              <div className="flex flex-col gap-px pl-9">
                <div className="flex h-[26px] items-center gap-2 text-[12px]">
                  <span className="icon-[lucide--square-terminal] size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/70">
                    ls .
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">0s</span>
                </div>
                <div className="flex h-[26px] items-center gap-2 text-[12px]">
                  <span className="icon-[lucide--file-text] size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/70">
                    package.json
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">0s</span>
                </div>
                <div className="mx-[-6px] flex h-[26px] items-center gap-2 rounded-md bg-brand/10 px-1.5">
                  <span className="icon-[lucide--loader-circle] size-3.5 animate-spin text-brand" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground">
                    find src -maxdepth 2 -type d | sort
                  </span>
                  <span className="text-[10px] tabular-nums text-brand">0.4s</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>失败：就地展开原因，给下一步动作</SectionLabel>
            <div className="flex flex-col gap-1">
              <div className="flex h-7 items-center gap-2 text-[12px]">
                <span className="size-1.5 rounded-full bg-destructive" />
                <span className="text-foreground">已停止</span>
                <span className="text-border">·</span>
                <span className="text-destructive">第 3 阶段有 1 次调用失败</span>
              </div>
              <div className="flex flex-col gap-1.5 pl-4">
                <div className="flex h-6 items-center gap-2">
                  <span className="icon-[lucide--circle-alert] size-3.5 text-destructive" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-destructive">
                    git ls-files packages | head -40
                  </span>
                  <span className="rounded bg-destructive/12 px-1.5 py-px text-[10px] text-destructive">
                    退出码 128
                  </span>
                </div>
                <div className="rounded-lg bg-destructive-soft px-2.5 py-2 font-mono text-[11px] leading-5 text-destructive">
                  fatal: not a git repository (or any of the parent directories): .git
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded-md px-2 py-1 text-[11px] text-foreground hover:bg-accent">
                    重试这一步
                  </span>
                  <span className="rounded-md px-2 py-1 text-[11px] text-muted-foreground">
                    跳过并继续
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>长输出：先给摘要，再按需展开全文</SectionLabel>
            <div className="flex flex-col gap-1.5 pl-4">
              <div className="flex h-6 items-center gap-2">
                <span className="icon-[lucide--square-terminal] size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/70">
                  ls src/agent | grep -v test | head -80
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/70">0.1s</span>
              </div>
              <div className="overflow-hidden rounded-lg bg-muted">
                <pre className="m-0 px-2.5 py-2 font-mono text-[11px] leading-[19px] text-muted-foreground">
                  {`adaptive.ts        agentHost.ts      compaction.ts
commandQueue.ts    goalState.ts      mcpTools.ts
messageStore.ts    sessionRunner.ts  supervisor.ts
toolRegistry.ts    usageLedger.ts`}
                </pre>
                <div className="flex h-7 items-center gap-1 border-t border-border/60 px-2.5 text-[11px] text-muted-foreground">
                  <span className="icon-[lucide--chevron-down] size-3" />共 42 个文件 · 展开全部
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>悬停：命令可复制、文件可打开</SectionLabel>
            <div className="flex flex-col gap-px pl-4">
              <div className="flex h-[26px] items-center gap-2 rounded-md bg-accent px-1.5">
                <span className="icon-[lucide--file-text] size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">
                  src/main/index.ts
                </span>
                <div className="flex items-center gap-0.5">
                  <span className="flex size-5 items-center justify-center rounded text-muted-foreground">
                    <span className="icon-[lucide--copy] size-3" />
                  </span>
                  <span className="flex size-5 items-center justify-center rounded text-muted-foreground">
                    <span className="icon-[lucide--external-link] size-3" />
                  </span>
                </div>
              </div>
              <div className="flex h-[26px] items-center gap-2 px-1.5">
                <span className="icon-[lucide--square-terminal] size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/70">
                  cat src/main/ipc/index.ts
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/70">0.1s</span>
              </div>
            </div>
          </div>
        </div>
      </ChatColumn>
    </Shell>
  );
}
