import type { PairBotMember, PairGroupEntry } from '@enso/pair';

/**
 * 群时间线的分层（设计稿 `group.tsx`）：
 * - L1 人说的话原样保留；
 * - L2 每个 Bot 每轮只留最后一段，中间的进度输出丢弃；
 * - L3 开工/交付/委派/验收压成一行活动行（`7 步 · 委派 1 次`），右侧给结果；
 * - 段头一行摘要（`今天 15:23` / `6 条消息，与 2 个 Bot`）。
 *
 * 纯函数：输入时间线条目，输出渲染用的行。
 */

export interface RowActivity {
  /** 进度条目数 + 工具步骤数（协议只给进度条目，按条数计步） */
  steps: number;
  /** 委派次数 */
  delegations: number;
  /** 右侧结果：已验收 / 进行中 / 失败 */
  state?: string;
  live: boolean;
}

export type GroupRow =
  | { kind: 'lead'; key: string; label: string }
  | { kind: 'human'; key: string; entry: Extract<PairGroupEntry, { kind: 'human' }> }
  | {
      kind: 'say';
      key: string;
      botId: string;
      name: string;
      at: number;
      text: string;
      /** 这句结论所属的成员会话（点开看过程用） */
      conversationId: string;
      /** 这句结论对应的群条目 id（产物卡片挂它） */
      entryId: string;
      activity?: RowActivity;
      /** 该轮最后一句话以外的同轮条目（点开看过程用） */
      folded: PairGroupEntry[];
    }
  | { kind: 'system'; key: string; entry: Extract<PairGroupEntry, { kind: 'system' }> };

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 段头时间：今天 15:23 / 昨天 15:23 / 11月13日 15:23 */
export function dayLeadLabel(at: number, now: number): string {
  const time = new Date(at);
  const hhmm = `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`;
  const today = startOfDay(now);
  const day = startOfDay(at);
  if (day === today) return `今天 ${hhmm}`;
  if (day === today - DAY) return `昨天 ${hhmm}`;
  return `${time.getMonth() + 1}月${time.getDate()}日 ${hhmm}`;
}

/** 分段摘要：6 条消息，与 2 个 Bot */
export function summaryLeadLabel(messages: number, bots: number): string {
  return `${messages} 条消息，与 ${bots} 个 Bot`;
}

/** 委派结果 → 活动行右侧的一句话 */
function delegationState(states: string[]): string | undefined {
  if (states.some((state) => state === 'running' || state === 'queued')) return '进行中';
  if (states.some((state) => state === 'failed')) return '失败';
  if (states.length > 0) return '已验收';
  return undefined;
}

/**
 * 把时间线条目归并成分层行。
 * @param now 本机时间，用来写「今天 / 昨天」段头
 */
export function groupRows(
  entries: readonly PairGroupEntry[],
  bots: ReadonlyMap<string, PairBotMember>,
  now: number
): GroupRow[] {
  const rows: GroupRow[] = [];
  /** 连续的一轮：同一 conversationId + turnId 的所有条目 */
  type Run = { conversationId: string; turnId: string; botId: string; entries: PairGroupEntry[] };
  let runs: Run[] = [];
  let day = Number.NaN;
  /** 先到的进度/委派条目：等它所属的那一轮第一句话到达后再并进去 */
  let pending: PairGroupEntry[] = [];

  const rowOfRun = (run: Run): GroupRow | null => {
    const botEntries = run.entries.filter(
      (entry): entry is Extract<PairGroupEntry, { kind: 'bot' }> => entry.kind === 'bot'
    );
    const last = botEntries.at(-1);
    if (!last) return null;
    const progress = run.entries.filter((entry) => entry.kind === 'progress');
    const delegations = run.entries.filter(
      (entry): entry is Extract<PairGroupEntry, { kind: 'delegation' }> =>
        entry.kind === 'delegation'
    );
    const state = delegationState(delegations.map((entry) => entry.state));
    const activity: RowActivity | undefined =
      progress.length > 0 || delegations.length > 0
        ? {
            steps: progress.length,
            delegations: delegations.length,
            ...(state ? { state } : {}),
            live: delegations.some((entry) => entry.state === 'running'),
          }
        : undefined;
    return {
      kind: 'say',
      key: `${run.conversationId}:${run.turnId}`,
      botId: run.botId,
      name: bots.get(run.botId)?.name ?? '成员',
      at: last.at,
      text: last.text,
      conversationId: last.conversationId,
      entryId: last.id,
      ...(activity ? { activity } : {}),
      // 同轮的过程条目：点开看过程时才需要
      folded: run.entries.filter((entry) => entry !== last),
    };
  };

  /** 收尾一段连续回复：先出行，多于一个 Bot 时补一行摘要 */
  const flushRuns = () => {
    const spoke = new Set<string>();
    let messages = 0;
    for (const run of runs) {
      const row = rowOfRun(run);
      if (!row) continue;
      rows.push(row);
      spoke.add(run.botId);
      messages += run.entries.length;
    }
    if (spoke.size >= 2) {
      rows.push({
        kind: 'lead',
        key: `sum:${rows.length}`,
        label: summaryLeadLabel(messages, spoke.size),
      });
    }
    runs = [];
    pending = [];
  };

  for (const entry of entries) {
    const entryDay = startOfDay(entry.at);
    if (entryDay !== day) {
      flushRuns();
      rows.push({ kind: 'lead', key: `day:${entryDay}`, label: dayLeadLabel(entry.at, now) });
      day = entryDay;
    }
    if (entry.kind === 'system') {
      flushRuns();
      rows.push({ kind: 'system', key: `sys:${entry.seq}`, entry });
      continue;
    }
    if (entry.kind === 'human') {
      flushRuns();
      rows.push({ kind: 'human', key: `h:${entry.seq}`, entry });
      continue;
    }
    const tail = runs.at(-1);
    if (entry.kind === 'bot') {
      if (!tail || tail.turnId !== entry.turnId || tail.conversationId !== entry.conversationId) {
        runs.push({
          conversationId: entry.conversationId,
          turnId: entry.turnId,
          botId: entry.botId,
          entries: [...pending, entry],
        });
        pending = [];
      } else {
        tail.entries.push(entry);
      }
      continue;
    }
    // progress / delegation：并入当前这一轮；还没有轮次就等它第一句话
    if (tail) tail.entries.push(entry);
    else pending.push(entry);
  }
  flushRuns();
  pending = [];
  return rows;
}
