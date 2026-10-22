export const frame = { width: 1440, height: 900, title: '方案 B · 命令时间轴' };

import { ChatColumn, ReplyHead, Shell, UserTurn } from '../components/Shell';

type Row = {
  kind: 'phase' | 'think' | 'call';
  label: string;
  text?: string;
  time?: string;
  failed?: boolean;
};

const ROWS: Row[] = [
  { kind: 'phase', label: '探查骨架 · 11 次' },
  { kind: 'think', label: '思考 2.8s' },
  { kind: 'call', label: '终端', text: 'ls .', time: '0s' },
  { kind: 'call', label: '读取', text: 'package.json', time: '0s' },
  { kind: 'think', label: '思考 1.2s' },
  {
    kind: 'call',
    label: '终端',
    text: 'cd ~/githubproject/EnsoCode && echo "=== src ===" && ls src',
    time: '0.3s',
  },
  {
    kind: 'call',
    label: '终端',
    text: 'find src -maxdepth 2 -type d | sort',
    time: '0.3s',
  },
  { kind: 'phase', label: '读取入口与 IPC · 6 次' },
  { kind: 'call', label: '读取', text: 'src/main/index.ts', time: '0s' },
  {
    kind: 'call',
    label: '终端',
    text: 'cat src/main/ipc/index.ts && ls src/main/ipc',
    time: '0.1s',
  },
  { kind: 'think', label: '思考 1.5s' },
  { kind: 'call', label: '读取', text: 'src/preload/index.ts', time: '0s' },
  { kind: 'call', label: '检索', text: 'IPC_CHANNELS', time: '0.2s' },
  { kind: 'phase', label: '核对依赖边界 · 5 次' },
  { kind: 'call', label: '读取', text: 'electron.vite.config.ts', time: '0s' },
  {
    kind: 'call',
    label: '终端',
    text: 'git ls-files packages | head -40',
    time: '0.1s',
    failed: true,
  },
  { kind: 'call', label: '读取', text: 'pnpm-workspace.yaml', time: '0s' },
  { kind: 'think', label: '思考 1.6s' },
];

export default function CommandTimeline() {
  return (
    <Shell label="方案 B · 命令时间轴">
      <ChatColumn>
        <UserTurn text="梳理一下这个项目的结构：入口、模块划分与关键依赖" />
        <div className="flex flex-col gap-3">
          <ReplyHead />
          <div>
            <div className="mb-1 flex h-7 items-center gap-2 text-[12px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              <span>已工作 20.9s</span>
              <span className="text-border">·</span>
              <span>22 次调用</span>
              <span className="ml-auto text-[11px] tabular-nums">11 段思考</span>
            </div>
            <div className="relative max-h-[404px] overflow-hidden">
              <div className="absolute inset-y-1 left-[7px] w-px bg-border" />
              <div className="flex flex-col">
                {ROWS.map((row) =>
                  row.kind === 'phase' ? (
                    <div key={row.label} className="flex h-7 items-center gap-2">
                      <span className="relative z-10 flex size-[15px] items-center justify-center bg-panel">
                        <span className="size-1.5 rounded-full bg-foreground/70" />
                      </span>
                      <span className="bg-panel pr-2 text-[11px] font-medium text-foreground">
                        {row.label}
                      </span>
                    </div>
                  ) : row.kind === 'think' ? (
                    <div key={row.label} className="flex h-6 items-center gap-2 pl-[2px]">
                      <span className="relative z-10 flex size-[11px] items-center justify-center rounded-full bg-panel">
                        <span className="size-[5px] rounded-full border border-muted-foreground/60 bg-panel" />
                      </span>
                      <span className="icon-[lucide--brain] size-3 text-muted-foreground/70" />
                      <span className="text-[11px] text-muted-foreground/80">{row.label}</span>
                    </div>
                  ) : (
                    <div key={row.text} className="flex h-6 items-center gap-2">
                      <span className="relative z-10 flex size-[15px] items-center justify-center bg-panel">
                        <span
                          className={`size-[7px] rounded-full ${row.failed ? 'bg-destructive' : 'bg-muted-foreground/45'}`}
                        />
                      </span>
                      {row.failed ? (
                        <span className="icon-[lucide--circle-alert] size-3 text-destructive" />
                      ) : (
                        <span
                          className={`${row.label === '读取' ? 'icon-[lucide--file-text]' : 'icon-[lucide--square-terminal]'} size-3 text-muted-foreground`}
                        />
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-[11px] ${row.failed ? 'text-destructive' : 'text-foreground/75'}`}
                      >
                        {row.text}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                        {row.time}
                      </span>
                    </div>
                  )
                )}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-panel via-panel/90 to-transparent pb-1">
                <span className="flex items-center gap-1 rounded-full border border-border bg-panel px-2.5 py-1 text-[11px] text-muted-foreground">
                  <span className="icon-[lucide--chevron-down] size-3" />
                  滚动查看全部 18 步
                </span>
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
