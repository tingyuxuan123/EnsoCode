export const frame = { width: 1440, height: 900, title: "Bot · 工作台首页（还没成员）" };

import { Link } from 'react-router';

/** 没有成员时：从目标开始 + 新建成员 / 从模板创建团队；模式切换在标题栏中间 */
export default function BotHome() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="icon-[lucide--bot-message-square] size-8 text-faint" />
      <p className="text-[18px] font-semibold">Bot 模式</p>
      <p className="max-w-[420px] text-[13px] leading-6 text-muted">用一句话说说你想做什么，我们推荐一位成员或一个团队，并帮你起草第一条消息。</p>
      <div className="mt-2 w-full max-w-[520px] rounded-control border border-border bg-input p-1.5 text-left focus-within:border-primary/60">
        <textarea rows={2} placeholder="例如：每周跟踪竞品动态，给我发一份摘要" aria-label="目标" className="block h-[52px] w-full resize-none bg-transparent px-2.5 py-2 text-[13.5px] leading-6 outline-none placeholder:text-faint" />
        <div className="flex items-center gap-2 px-1 pb-1">
          <span className="text-[11px] text-faint">Agent 会推荐成员或一个团队</span>
          <Link to="/bot-goal" className="ml-auto rounded-control bg-primary px-3 py-1 text-[12px] text-primary-foreground">继续</Link>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 text-[12px]">
        <Link to="/bot-new-member" className="flex h-8 items-center gap-1.5 rounded-control bg-surface-foreground px-3 text-surface"><span className="icon-[lucide--user-plus] size-3.5" />新建成员</Link>
        <Link to="/bot-new-team" className="flex h-8 items-center gap-1.5 rounded-control border border-border px-3 hover:bg-hover"><span className="icon-[lucide--layout-template] size-3.5" />从模板创建团队</Link>
      </div>
    </div>
  );
}
