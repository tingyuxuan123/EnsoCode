import type { PairBotMember, PairDelegationState, PairGroupEntry } from '@enso/pair';

/**
 * 通信空间（设计稿 `bot-comms.tsx`）：群时间线里的委派条目 → 一屏只读的来去记录。
 * 只给「谁让谁做什么、结果如何」；本机路径和原始指令留在桌面端，不下发到手机。
 */
export interface CommsRow {
  key: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  /** 任务一句话（desk 端下发的 summary；没有就退回状态） */
  task: string;
  /** 右侧状态文案 */
  state: string;
  live: boolean;
  at: number;
}

const STATE_TEXT: Record<PairDelegationState, string> = {
  queued: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
  blocked: '卡住了',
};

/** 相对时间：刚刚 / 12 分钟 / 2 小时 / 昨天 15:20 */
export function commsAgo(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `昨天 ${hh}:${mm}`;
}

/**
 * 把委派条目按 id 去重后倒序排；同一委派的 progress 只用来刷新状态，不单独成行。
 * 成员名解析不到时退回 botId，便于发现问题而不是静默丢弃。
 */
export function commsRows(
  entries: readonly PairGroupEntry[],
  bots: ReadonlyMap<string, PairBotMember>,
  now: number
): CommsRow[] {
  const byDelegation = new Map<string, CommsRow>();
  for (const entry of entries) {
    if (entry.kind !== 'delegation') continue;
    const from = entry.from;
    const to = entry.to;
    const fromName = bots.get(from)?.name ?? from;
    const toName = bots.get(to)?.name ?? to;
    const row: CommsRow = {
      key: entry.delegationId,
      fromId: from,
      toId: to,
      fromName,
      toName,
      task: entry.summary?.trim() || '（没有附任务说明）',
      state: `${STATE_TEXT[entry.state]} · ${commsAgo(entry.at, now)}`,
      live: entry.state === 'running' || entry.state === 'queued',
      at: entry.at,
    };
    // 同一委派可能出现多条（重试/追加），保留最新一条
    const prior = byDelegation.get(row.key);
    if (!prior || prior.at <= row.at) byDelegation.set(row.key, row);
  }
  return [...byDelegation.values()].sort((a, b) => b.at - a.at);
}
