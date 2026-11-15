export const frame = { width: 402, height: 874, radius: 62, title: "会话设置" };

import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { Sheet, SheetLabel } from "../components/Sheet";
import { Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

const models = [
  { name: "Sonnet 4.6", note: "日常，快" },
  { name: "Opus 4.6", note: "难一点的推理" },
  { name: "gpt-6.1-sol", note: "另一家，备用" },
];

const levels = ["关", "低", "中", "高", "max"];

// 会话设置：模型、推理开关、思考等级都在一张面板里；底下的页面保持原样。
export default function Config() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-page">
      <StatusBar variant="island" tone="dark" />
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span className="flex size-12 items-center justify-center text-ink">
          <span className="icon-[lucide--menu] size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-[22px] font-medium">恢复会话后时间线为空</div>
          <div className="truncate text-[12px] leading-4 text-dim">EnsoCode · Sonnet 4.6 · 思考 高</div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
        <UserBubble>恢复会话后时间线是空的，帮我查根因。</UserBubble>
        <article className="flex flex-col gap-2.5">
          <TurnHead time="3 分钟前" />
          <Steps>已完成 7 步 · 读了 5 个文件</Steps>
          <Prose>
            <p>根因在 reducer：恢复时 worker 从 seq 1 回放，而 store 还留着旧的 lastSeq。</p>
          </Prose>
        </article>
      </div>
      <Composer meta={{ context: 38, tokens: "12.4k", cache: "92%", speed: "42 t/s" }} />
      <Sheet
        backTo="/chat"
        title="会话设置"
        aside={
          <span className="rounded-full bg-card2 px-2.5 py-1 text-[12px] leading-4 font-medium text-ink2">
            仅本会话
          </span>
        }
      >
        <div className="px-5 pb-2">
          <SheetLabel>模型</SheetLabel>
          <div className="flex flex-col gap-2">
            {models.map((m, i) => (
              <div
                key={m.name}
                className={`flex items-center gap-3 rounded-[16px] bg-card px-4 py-3 ${
                  i === 0 ? "shadow-[inset_0_0_0_2px_var(--color-ink)]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-5 font-medium">{m.name}</p>
                  <p className="text-[12px] leading-4 text-dim">{m.note}</p>
                </div>
                {i === 0 && <span className="icon-[lucide--check] size-4" />}
              </div>
            ))}
          </div>
          <SheetLabel>推理</SheetLabel>
          <div className="flex items-center gap-3 rounded-[16px] bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-5 font-medium">开启动推理</p>
              <p className="text-[12px] leading-4 text-dim">会多花几秒，难题更稳</p>
            </div>
            <span className="flex h-7 w-12 items-center rounded-full bg-pill p-1">
              <span className="ml-auto size-5 rounded-full bg-pill-ink" />
            </span>
          </div>
          <SheetLabel>思考等级</SheetLabel>
          <div className="flex rounded-full bg-card2 p-1">
            {levels.map((l) => (
              <span
                key={l}
                className={`flex h-9 flex-1 items-center justify-center rounded-full text-[14px] leading-5 font-medium ${
                  l === "高" ? "bg-card text-ink shadow-[0_1px_3px_rgb(0_0_0/0.08)]" : "text-dim"
                }`}
              >
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="px-5 pt-4">
          <button className="h-12 w-full rounded-full bg-pill text-[15px] font-medium text-pill-ink">
            完成
          </button>
        </div>
      </Sheet>
    </div>
  );
}
